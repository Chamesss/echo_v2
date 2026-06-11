import type { PoolClient } from "pg";
import { withTenantSchema } from "../../infrastructure/database/tenant/client.js";
import { hub } from "../../infrastructure/realtime/hub.js";
import type { MessageWire } from "../../infrastructure/realtime/protocol.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors/app-error.js";
import { ErrorCode } from "../../shared/errors/error-codes.js";
import { assertChannelMember } from "./channels.service.js";
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
}

const MESSAGE_COLUMNS = `id, channel_id, author_id, body, client_id, seq, updated_seq, version, deleted, created_at, updated_at`;

function toWire(row: MessageRow): MessageWire {
  return {
    id: row.id,
    channelId: row.channel_id,
    authorId: row.author_id,
    body: row.body,
    clientId: row.client_id,
    seq: row.seq,
    updatedSeq: row.updated_seq,
    version: row.version,
    deleted: row.deleted,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
  };
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
  input: { clientId: string; body: string },
): Promise<MessageWire> {
  const { message, created } = await withTenantSchema(workspaceId, async (db) => {
    await assertChannelMember(db, channelId, userId);

    // Serialize this channel's writers: hold the row lock for the whole tx so
    // the idempotency check and the seq bump can't interleave.
    await db.query(`SELECT 1 FROM channels WHERE id = $1 FOR UPDATE`, [channelId]);

    const existing = await db.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE channel_id = $1 AND client_id = $2`,
      [channelId, input.clientId],
    );
    if (existing.rows[0]) return { message: toWire(existing.rows[0]), created: false };

    const seq = await bumpClock(db, channelId);
    const { rows } = await db.query<MessageRow>(
      `INSERT INTO messages (channel_id, author_id, body, client_id, seq, updated_seq)
       VALUES ($1, $2, $3, $4, $5, $5)
       RETURNING ${MESSAGE_COLUMNS}`,
      [channelId, userId, input.body, input.clientId, seq],
    );
    return { message: toWire(rows[0]!), created: true };
  });

  if (created) {
    await hub.publish(workspaceId, {
      kind: "message.created",
      channelId,
      updatedSeq: message.updatedSeq,
      message,
    });
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

    if (q.since !== undefined) {
      const { rows } = await db.query<MessageRow>(
        `SELECT ${MESSAGE_COLUMNS} FROM messages
          WHERE channel_id = $1 AND updated_seq > $2
          ORDER BY updated_seq ASC
          LIMIT $3`,
        [channelId, q.since, q.limit],
      );
      return rows.map(toWire);
    }

    const params: unknown[] = [channelId];
    let where = `channel_id = $1 AND deleted = false`;
    if (q.before !== undefined) {
      params.push(q.before);
      where += ` AND seq < $${params.length}`;
    }
    params.push(q.limit);
    const { rows } = await db.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages
        WHERE ${where}
        ORDER BY seq DESC
        LIMIT $${params.length}`,
      params,
    );
    return rows.map(toWire);
  });
}

/** Edit a message (author only). Snapshots the prior version into revisions. */
export async function editMessage(
  workspaceId: string,
  channelId: string,
  messageId: string,
  userId: string,
  body: string,
): Promise<MessageWire> {
  const message = await withTenantSchema(workspaceId, async (db) => {
    await assertChannelMember(db, channelId, userId);
    const current = await loadOwnedMessage(db, channelId, messageId, userId);

    // Preserve the outgoing version so full edit history is reconstructable.
    await db.query(
      `INSERT INTO message_revisions (message_id, version, body) VALUES ($1, $2, $3)`,
      [messageId, current.version, current.body],
    );
    const seq = await bumpClock(db, channelId);
    const { rows } = await db.query<MessageRow>(
      `UPDATE messages
          SET body = $1, version = version + 1, updated_seq = $2, updated_at = now()
        WHERE id = $3
        RETURNING ${MESSAGE_COLUMNS}`,
      [body, seq, messageId],
    );
    return toWire(rows[0]!);
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
    const { rows } = await db.query<{ last_read_seq: number }>(
      `UPDATE channel_members
          SET last_read_seq = GREATEST(last_read_seq, $1)
        WHERE channel_id = $2 AND user_id = $3
        RETURNING last_read_seq`,
      [seq, channelId, userId],
    );
    return rows[0]!.last_read_seq;
  });

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
