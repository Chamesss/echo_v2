import type { PoolClient } from "pg";
import { withTenantSchema } from "../../infrastructure/database/tenant/client.js";
import { hub } from "../../infrastructure/realtime/hub.js";
import type { AttachmentWire, MessageWire } from "../../infrastructure/realtime/protocol.js";
import {
  resolveAttachmentsForSend,
  type ResolvedAttachment,
} from "../attachments/attachments.service.js";
import { fileProxyUrl } from "../files/files.service.js";
import { markRead as markNotificationsRead } from "../notifications/notifications.service.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../shared/errors/app-error.js";
import { ErrorCode } from "../../shared/errors/error-codes.js";
import { assertChannelMember } from "./channels.gates.js";
import { fanOutAwareness, trackFanOut } from "./messages.awareness.js";
import type { ListMessagesQuery } from "./channels.dto.js";

/**
 * The messaging engine. Every write runs in a tenant transaction and assigns a
 * GAPLESS per-channel sequence: the channel row is locked, then the change clock
 * (`channels.last_seq`) is bumped and stamped onto the row's `seq`/`updated_seq`.
 * That lock serializes concurrent writes per channel so sequences never skip —
 * which is what lets clients detect gaps and self-heal via the `?since=` catch-up
 * endpoint. The socket broadcast is fired AFTER commit and is purely an
 * accelerator; it is never the source of truth.
 */

interface MessageRow {
  id: string;
  channel_id: string;
  author_id: string;
  body: string;
  client_id: string;
  seq: number;
  updated_seq: number;
  version: number;
  deleted: boolean;
  created_at: Date;
  updated_at: Date | null;
  // Only present on read paths that join membership (listMessages). undefined on
  // the write paths (sendMessage/edit/delete), whose author is the caller.
  author_active?: boolean;
  // Author identity snapshot, joined in only on read paths (see toWire).
  author_name?: string | null;
  author_image?: string | null;
}

const MESSAGE_COLUMNS = `id, channel_id, author_id, body, client_id, seq, updated_seq, version, deleted, created_at, updated_at`;

// Read paths additionally compute author_active by joining membership and carry
// an author identity snapshot from the users table (alias `m` for messages,
// `mem` for the LEFT-JOINed memberships row, `u` for the author's user row).
const MESSAGE_READ_COLUMNS = `m.id, m.channel_id, m.author_id, m.body, m.client_id, m.seq, m.updated_seq, m.version, m.deleted, m.created_at, m.updated_at, (mem.user_id IS NOT NULL) AS author_active, u.name AS author_name, u.image AS author_image`;

// Read-path joins: membership (to compute author_active) + the author's user
// row (to snapshot name/image). Both live in the control plane, reachable via
// the tenant search_path. `$1::uuid` because workspace_id is a uuid.
const MESSAGE_READ_JOINS = `LEFT JOIN memberships mem ON mem.user_id = m.author_id AND mem.workspace_id = $1::uuid
         LEFT JOIN users u ON u.id = m.author_id`;

function toWire(row: MessageRow): MessageWire {
  // `author_active` is set only by listMessages. When the author has left the
  // workspace we withhold the body and flag it — reversible: if they rejoin,
  // the next read returns active=true and the body again.
  const active = row.author_active !== false;
  return {
    id: row.id,
    channelId: row.channel_id,
    authorId: row.author_id,
    body: active ? row.body : "",
    clientId: row.client_id,
    seq: row.seq,
    updatedSeq: row.updated_seq,
    version: row.version,
    deleted: row.deleted,
    authorActive: active,
    // Snapshot the author's identity for a flash-free first paint — but withhold
    // it for departed authors, mirroring the body so a "Former member" row leaks
    // no name/avatar. Undefined on write paths (no join); the wire omits it.
    authorName: active ? (row.author_name ?? undefined) : undefined,
    authorImage: active ? (row.author_image ?? null) : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
  };
}

// ─── Attachments ──────────────────────────────────────────────────────────

interface AttachmentRow {
  id: string;
  message_id: string;
  s3_key: string;
  filename: string;
  content_type: string;
  size_bytes: string | number; // bigint → string from node-postgres
  category: string;
}

const ATTACHMENT_COLUMNS = `id, message_id, s3_key, filename, content_type, size_bytes, category`;

/**
 * Build a wire attachment. The `url` is a STABLE pointer at our signed-redirect
 * endpoint (`/api/files?key=…`), NOT a presigned S3 URL: objects are private, so
 * each browser load 302s through that endpoint to a freshly-signed, short-lived
 * GET. That keeps cached/edited message rows valid forever (no expiry) while
 * never exposing the bucket's public URL.
 */
function toAttachmentWire(r: AttachmentRow): AttachmentWire {
  return {
    id: r.id,
    filename: r.filename,
    contentType: r.content_type,
    size: Number(r.size_bytes),
    category: r.category as AttachmentWire["category"],
    url: fileProxyUrl(r.s3_key),
  };
}

/** Persist a message's resolved attachments (in the send tx); returns the wire rows. */
async function insertAttachments(
  db: PoolClient,
  messageId: string,
  items: ResolvedAttachment[],
): Promise<AttachmentWire[]> {
  const wires: AttachmentWire[] = [];
  for (const a of items) {
    const { rows } = await db.query<AttachmentRow>(
      `INSERT INTO attachments (message_id, s3_key, url, filename, content_type, size_bytes, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${ATTACHMENT_COLUMNS}`,
      [messageId, a.s3Key, a.url, a.filename, a.contentType, a.sizeBytes, a.category],
    );
    wires.push(toAttachmentWire(rows[0]!));
  }
  return wires;
}

/**
 * Batch-load attachments for a set of message wires and assign them in place.
 * Withheld (set to `[]`) for departed authors, mirroring the body/identity
 * hiding in `toWire`.
 */
async function attachAttachments(db: PoolClient, wires: MessageWire[]): Promise<void> {
  const ids = wires.filter((w) => w.authorActive !== false).map((w) => w.id);
  const byMessage = new Map<string, AttachmentWire[]>();
  if (ids.length > 0) {
    const { rows } = await db.query<AttachmentRow>(
      `SELECT ${ATTACHMENT_COLUMNS} FROM attachments
        WHERE message_id = ANY($1::uuid[])
        ORDER BY created_at ASC`,
      [ids],
    );
    for (const r of rows) {
      const list = byMessage.get(r.message_id) ?? [];
      list.push(toAttachmentWire(r));
      byMessage.set(r.message_id, list);
    }
  }
  for (const w of wires) {
    w.attachments = w.authorActive === false ? [] : (byMessage.get(w.id) ?? []);
  }
}

/** Load one message's attachments (idempotent-send path). */
async function loadAttachments(db: PoolClient, messageId: string): Promise<AttachmentWire[]> {
  const { rows } = await db.query<AttachmentRow>(
    `SELECT ${ATTACHMENT_COLUMNS} FROM attachments WHERE message_id = $1 ORDER BY created_at ASC`,
    [messageId],
  );
  return rows.map(toAttachmentWire);
}

/** Lock the channel row and return the next gapless clock value. */
async function bumpClock(db: PoolClient, channelId: string): Promise<number> {
  const { rows } = await db.query<{ last_seq: number }>(
    `UPDATE channels SET last_seq = last_seq + 1 WHERE id = $1 RETURNING last_seq`,
    [channelId],
  );
  return rows[0]!.last_seq;
}

/**
 * Send a message. Idempotent on `(channel_id, client_id)`: a retried send (same
 * clientId) returns the existing row WITHOUT burning a sequence, so optimistic
 * clients reconcile cleanly and network retries are safe.
 */
export async function sendMessage(
  workspaceId: string,
  channelId: string,
  userId: string,
  input: { clientId: string; body: string; attachments?: { key: string; filename: string }[] },
): Promise<MessageWire> {
  // Verify + resolve attachments BEFORE the tx (S3 HEAD + ownership + policy):
  // the stored type/size is S3-authoritative and a bad/incomplete upload fails
  // the send before any row is written.
  const resolvedAttachments = await resolveAttachmentsForSend(
    workspaceId,
    channelId,
    userId,
    input.attachments ?? [],
  );

  const { message, created } = await withTenantSchema(workspaceId, async (db) => {
    await assertChannelMember(db, channelId, userId);

    // Serialize this channel's writers: hold the row lock for the whole tx so
    // the idempotency check and the seq bump can't interleave.
    await db.query(`SELECT 1 FROM channels WHERE id = $1 FOR UPDATE`, [channelId]);

    const existing = await db.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE channel_id = $1 AND client_id = $2`,
      [channelId, input.clientId],
    );
    if (existing.rows[0]) {
      const wire = toWire(existing.rows[0]);
      wire.attachments = await loadAttachments(db, wire.id);
      return { message: wire, created: false };
    }

    const seq = await bumpClock(db, channelId);
    const { rows } = await db.query<MessageRow>(
      `INSERT INTO messages (channel_id, author_id, body, client_id, seq, updated_seq)
       VALUES ($1, $2, $3, $4, $5, $5)
       RETURNING ${MESSAGE_COLUMNS}`,
      [channelId, userId, input.body, input.clientId, seq],
    );
    // Unread is `channels.last_seq - channel_members.last_read_seq`, so the bump
    // above counts the author's own message against them. Advance their cursor in
    // the same tx: "you have read what you just wrote" is an invariant, not
    // something to leave to a best-effort mark-read from the client.
    await db.query(
      `UPDATE channel_members
          SET last_read_seq = GREATEST(last_read_seq, $1)
        WHERE channel_id = $2 AND user_id = $3`,
      [seq, channelId, userId],
    );

    const wire = toWire(rows[0]!);
    wire.attachments = await insertAttachments(db, wire.id, resolvedAttachments);
    return { message: wire, created: true };
  });

  if (created) {
    await hub.publish(workspaceId, {
      kind: "message.created",
      channelId,
      updatedSeq: message.updatedSeq,
      message,
    });
    // Deliberately NOT awaited. Everything that makes a send durable and visible
    // has already happened — the row is committed and the channel broadcast is
    // out — and this function is best-effort by contract (see below). Awaiting it
    // put a member lookup and a control-plane insert inside the caller's wait for
    // no gain in correctness; on a slow database that was the dominant cost of
    // sending a message. It owns its own error handling, so nothing escapes.
    trackFanOut(fanOutAwareness(workspaceId, channelId, userId, message));
  }
  return message;
}

/**
 * Read messages. `since` = catch-up: every row changed after that clock value
 * (creates, edits, AND deletes) in clock order — the reconciliation path.
 * Otherwise: a newest-first history page keyed on `seq` (excludes deletes).
 */
export async function listMessages(
  workspaceId: string,
  channelId: string,
  userId: string,
  q: ListMessagesQuery,
): Promise<MessageWire[]> {
  return withTenantSchema(workspaceId, async (db) => {
    await assertChannelMember(db, channelId, userId);

    // Join membership (to tell whether each author is still in the workspace;
    // departed authors get their body + identity withheld in toWire) and the
    // author's user row (to snapshot name/image). See MESSAGE_READ_JOINS.
    if (q.since !== undefined) {
      const { rows } = await db.query<MessageRow>(
        `SELECT ${MESSAGE_READ_COLUMNS}
           FROM messages m
           ${MESSAGE_READ_JOINS}
          WHERE m.channel_id = $2 AND m.updated_seq > $3
          ORDER BY m.updated_seq ASC
          LIMIT $4`,
        [workspaceId, channelId, q.since, q.limit],
      );
      const wires = rows.map(toWire);
      await attachAttachments(db, wires);
      return wires;
    }

    const params: unknown[] = [workspaceId, channelId];
    let where = `m.channel_id = $2 AND m.deleted = false`;
    if (q.before !== undefined) {
      params.push(q.before);
      where += ` AND m.seq < $${params.length}`;
    }
    params.push(q.limit);
    const { rows } = await db.query<MessageRow>(
      `SELECT ${MESSAGE_READ_COLUMNS}
         FROM messages m
         ${MESSAGE_READ_JOINS}
        WHERE ${where}
        ORDER BY m.seq DESC
        LIMIT $${params.length}`,
      params,
    );
    const wires = rows.map(toWire);
    await attachAttachments(db, wires);
    return wires;
  });
}

/**
 * Edit a message (author only). Snapshots the prior version into revisions and
 * can reconcile attachments (keep a subset of existing + add newly-uploaded),
 * Slack/GitHub-style. `keepAttachmentIds === undefined` leaves attachments
 * untouched (plain text edit); otherwise the set is reconciled to exactly the
 * kept ids + the new uploads. The result can't be empty (text or ≥1 attachment).
 */
export async function editMessage(
  workspaceId: string,
  channelId: string,
  messageId: string,
  userId: string,
  input: { body: string; keepAttachmentIds?: string[]; attachments?: { key: string; filename: string }[] },
): Promise<MessageWire> {
  // Verify + resolve new uploads before the tx (S3 HEAD + ownership + policy).
  const newAttachments = await resolveAttachmentsForSend(
    workspaceId,
    channelId,
    userId,
    input.attachments ?? [],
  );

  const message = await withTenantSchema(workspaceId, async (db) => {
    await assertChannelMember(db, channelId, userId);
    const current = await loadOwnedMessage(db, channelId, messageId, userId);

    // Preserve the outgoing version so full edit history is reconstructable.
    await db.query(
      `INSERT INTO message_revisions (message_id, version, body) VALUES ($1, $2, $3)`,
      [messageId, current.version, current.body],
    );

    // Reconcile attachments only when the client is managing them: drop the
    // existing rows the user removed (an empty keep-set removes them all).
    if (input.keepAttachmentIds !== undefined) {
      await db.query(
        `DELETE FROM attachments WHERE message_id = $1 AND NOT (id = ANY($2::uuid[]))`,
        [messageId, input.keepAttachmentIds],
      );
    }

    const seq = await bumpClock(db, channelId);
    const { rows } = await db.query<MessageRow>(
      `UPDATE messages
          SET body = $1, version = version + 1, updated_seq = $2, updated_at = now()
        WHERE id = $3
        RETURNING ${MESSAGE_COLUMNS}`,
      [input.body, seq, messageId],
    );
    const wire = toWire(rows[0]!);
    if (newAttachments.length > 0) await insertAttachments(db, messageId, newAttachments);
    // Carry the final attachment set on the wire, or the updated row (response +
    // `message.updated` broadcast) would clobber it out of every client's cache.
    wire.attachments = await loadAttachments(db, messageId);

    if (wire.body.length === 0 && wire.attachments.length === 0) {
      throw new BadRequestError(
        "A message needs text or at least one attachment",
        ErrorCode.BadRequest,
      );
    }
    return wire;
  });

  await hub.publish(workspaceId, {
    kind: "message.updated",
    channelId,
    updatedSeq: message.updatedSeq,
    message,
  });
  return message;
}

/** Soft-delete a message (author only); clears the body so it doesn't ship. */
export async function deleteMessage(
  workspaceId: string,
  channelId: string,
  messageId: string,
  userId: string,
): Promise<MessageWire> {
  const message = await withTenantSchema(workspaceId, async (db) => {
    await assertChannelMember(db, channelId, userId);
    await loadOwnedMessage(db, channelId, messageId, userId);
    const seq = await bumpClock(db, channelId);
    const { rows } = await db.query<MessageRow>(
      `UPDATE messages
          SET deleted = true, body = '', updated_seq = $1, updated_at = now()
        WHERE id = $2
        RETURNING ${MESSAGE_COLUMNS}`,
      [seq, messageId],
    );
    return toWire(rows[0]!);
  });

  await hub.publish(workspaceId, {
    kind: "message.deleted",
    channelId,
    updatedSeq: message.updatedSeq,
    message,
  });
  return message;
}

/** Advance the caller's read cursor; broadcast so their other devices sync. */
export async function markRead(
  workspaceId: string,
  channelId: string,
  userId: string,
  seq: number,
): Promise<{ lastReadSeq: number }> {
  const lastReadSeq = await withTenantSchema(workspaceId, async (db) => {
    await assertChannelMember(db, channelId, userId);
    // Clients mark read with a message seq, but unread is measured against
    // `channels.last_seq` — which edits and deletes also bump without producing a
    // new markable message. So when the submitted seq covers every non-deleted
    // message the reader is caught up by definition: promote the cursor to the
    // channel clock, or those ticks strand an unread nothing can ever clear.
    const { rows } = await db.query<{ last_read_seq: number }>(
      `UPDATE channel_members
          SET last_read_seq = GREATEST(
                last_read_seq,
                CASE WHEN $1 >= COALESCE(
                       (SELECT MAX(seq) FROM messages
                         WHERE channel_id = $2 AND deleted = false), 0)
                     THEN (SELECT last_seq FROM channels WHERE id = $2)
                     ELSE $1 END)
        WHERE channel_id = $2 AND user_id = $3
        RETURNING last_read_seq`,
      [seq, channelId, userId],
    );
    return rows[0]!.last_read_seq;
  });

  // The cursor and the inbox are two records of the same fact — "this person has
  // read this conversation" — and they used to move independently. The client
  // cleared notifications ONCE per channel open while the cursor kept advancing
  // on every focus, so anything arriving after that first moment stayed unread in
  // the bell forever; worse, messages read while the tab was visible were only
  // suppressed client-side, so the count came back on reload. Driving both from
  // this one signal makes divergence impossible. Normally updates zero rows.
  await markNotificationsRead(userId, { channelId });

  await hub.publish(workspaceId, { kind: "channel.read", channelId, userId, lastReadSeq });
  return { lastReadSeq };
}

/** Fetch a non-deleted message and assert the caller authored it. */
async function loadOwnedMessage(
  db: PoolClient,
  channelId: string,
  messageId: string,
  userId: string,
): Promise<MessageRow> {
  const { rows } = await db.query<MessageRow>(
    `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = $1 AND channel_id = $2`,
    [messageId, channelId],
  );
  const message = rows[0];
  if (!message || message.deleted) {
    throw new NotFoundError("Message not found", ErrorCode.MessageNotFound);
  }
  if (message.author_id !== userId) {
    throw new ForbiddenError("You can only modify your own messages", ErrorCode.NotMessageAuthor);
  }
  return message;
}
