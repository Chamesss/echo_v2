import type { PoolClient } from "pg";
import { withTenantSchema } from "../../infrastructure/database/tenant/client.js";
import { emitUserEvents, UserEvents } from "../../infrastructure/realtime/events.js";
import { participantLabel } from "../notifications/notification-copy.js";
import { BadRequestError, NotFoundError } from "../../shared/errors/app-error.js";
import { ErrorCode } from "../../shared/errors/error-codes.js";
import type { ChannelDTO } from "./channels.service.js";

/**
 * Direct & group messages. Both are `channels` rows — type `direct` (exactly 2
 * people) or `group` (3+) — and the two are addressed differently on purpose:
 *
 * - A `direct` channel carries a canonical `dm_key` derived from the sorted
 *   participant pair, so "open a DM with X" is idempotent: the same two people
 *   always resolve to the same channel, and the `dm_key` unique index enforces
 *   that even under a race.
 * - A `group` has NO `dm_key`. Its membership can change and it can be renamed,
 *   so it isn't identified by who happened to be in it at creation — asking for
 *   a group always creates a new one. See `openOrCreateDm` below.
 *
 * Messaging/edit/catch-up reuse the channel engine unchanged; only open-or-create
 * + listing live here.
 */

export interface DmParticipant {
  userId: string;
  name: string;
  image: string | null;
}

/** A DM is a channel plus its participants; `name` is a label of the others. */
export interface DirectMessageDTO extends ChannelDTO {
  participants: DmParticipant[];
  /**
   * The name the conversation was given, if any — as opposed to `name`, which
   * falls back to a label built from the participants.
   *
   * Exposed separately so the settings form can tell "named Project X" from
   * "currently displaying Alice, Bob". Without it, opening settings on an
   * unnamed group and pressing Save would freeze today's participant list as a
   * permanent title.
   */
  customName: string | null;
}

/**
 * Order-independent key for a participant set — used for 1:1s ONLY.
 *
 * It exists to answer "do these two already have a conversation?", and that
 * question only has an answer while the member set can't change. A 1:1's is
 * fixed by rule (adding a third person starts a new group instead), so the key
 * stays truthful forever. A group's doesn't, which is why groups aren't keyed.
 */
function dmKey(userIds: string[]): string {
  return [...new Set(userIds)].sort().join(":");
}

/**
 * Fallback display label for a conversation with no name of its own: the OTHER
 * participants' names.
 *
 * Falls back to the full set when the caller is the only one left — reachable
 * when everyone else has left a group, not (as an earlier comment claimed) via a
 * self-DM, which `openOrCreateDm` rejects outright.
 */
function label(participants: DmParticipant[], selfId: string): string {
  const others = participants.filter((p) => p.userId !== selfId);
  // Uncapped: a sidebar row gets a whole line, so it names everyone. The
  // notification fan-out caps the same helper — one rule for how we name a
  // group, two budgets for how much room it has.
  return participantLabel((others.length ? others : participants).map((p) => p.name));
}

/** Build a DM DTO (channel + read-state for `selfId` + participants). */
async function buildDmDTO(
  db: PoolClient,
  channelId: string,
  selfId: string,
): Promise<DirectMessageDTO> {
  const { rows } = await db.query<{
    id: string;
    type: ChannelDTO["type"];
    name: string | null;
    topic: string | null;
    archived: boolean;
    created_by: string | null;
    last_seq: number;
    created_at: Date;
    last_read_seq: number | null;
    is_member: boolean;
  }>(
    `SELECT c.id, c.type, c.name, c.topic, c.archived, c.created_by, c.last_seq, c.created_at,
            cm.last_read_seq, (cm.user_id IS NOT NULL) AS is_member
       FROM channels c
       LEFT JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $2
      WHERE c.id = $1`,
    [channelId, selfId],
  );
  const c = rows[0]!;

  const { rows: parts } = await db.query<{ user_id: string; name: string; image: string | null }>(
    `SELECT cm.user_id, u.name, u.image
       FROM channel_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.channel_id = $1 ORDER BY u.name`,
    [channelId],
  );
  const participants = parts.map((p) => ({ userId: p.user_id, name: p.name, image: p.image ?? null }));

  return {
    id: c.id,
    type: c.type,
    // A group may carry a name of its own; otherwise it's labelled by who's in
    // it. Selecting `c.name` is what makes a group rename readable — without it
    // the stored value was overwritten here on every read, so renaming a group
    // persisted and then vanished.
    name: c.name ?? label(participants, selfId),
    customName: c.name,
    topic: c.topic,
    archived: c.archived,
    createdBy: c.created_by,
    lastSeq: c.last_seq,
    isMember: c.is_member,
    unread: c.is_member ? Math.max(0, c.last_seq - (c.last_read_seq ?? 0)) : 0,
    createdAt: c.created_at.toISOString(),
    participants,
  };
}

/**
 * Open a 1:1, or create a group conversation.
 *
 * The two halves behave differently on purpose:
 *
 *   - **1:1** is idempotent on the participant pair. Its member set can never
 *     change (adding a third person creates a group instead), so `dm_key`
 *     identifies it for good and picking the same person twice always lands in
 *     the same conversation.
 *   - **Group** is not keyed and always creates. Its membership is mutable and
 *     it can be renamed, so it is its own entity rather than a function of who
 *     started in it — two separate groups with the same people is legitimate,
 *     and a key would go stale the moment anyone joined or left.
 *
 * All participants must be members of the workspace.
 */
export async function openOrCreateDm(
  workspaceId: string,
  creatorId: string,
  otherUserIds: string[],
): Promise<DirectMessageDTO> {
  const participants = [...new Set([creatorId, ...otherUserIds])];
  if (participants.length < 2) {
    throw new BadRequestError("A direct message needs at least one other person", ErrorCode.BadRequest);
  }
  const isDirect = participants.length === 2;
  const type = isDirect ? "direct" : "group";
  const key = isDirect ? dmKey(participants) : null;

  const { dto, created } = await withTenantSchema(workspaceId, async (db) => {
    // Every participant must be a workspace member (public.memberships via search_path).
    const { rows: count } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM memberships WHERE workspace_id = $1 AND user_id = ANY($2::text[])`,
      [workspaceId, participants],
    );
    if (count[0]!.n !== participants.length) {
      throw new NotFoundError("All participants must be workspace members", ErrorCode.NotAMember);
    }

    let channelId: string;
    let wasCreated: boolean;

    if (key === null) {
      // Group: never resolves to an existing row.
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO channels (type, created_by) VALUES ($1, $2) RETURNING id`,
        [type, creatorId],
      );
      channelId = rows[0]!.id;
      wasCreated = true;
    } else {
      // 1:1 open-or-create. The dm_key unique index makes this safe under
      // concurrency; a returned row means we created it rather than resolved
      // one, and only a brand-new conversation notifies the other participant.
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO channels (type, dm_key, created_by) VALUES ($1, $2, $3)
         ON CONFLICT (dm_key) DO NOTHING RETURNING id`,
        [type, key, creatorId],
      );
      wasCreated = inserted.rows.length > 0;
      channelId =
        inserted.rows[0]?.id ??
        (await db.query<{ id: string }>(`SELECT id FROM channels WHERE dm_key = $1`, [key]))
          .rows[0]!.id;
    }

    // Seed/ensure membership for all participants (idempotent). `last_read_seq`
    // starts at the channel's current clock so pre-existing history isn't
    // "unread" — matching `joinChannel` and `addChannelMember`. It only differs
    // from 0 when someone rejoins a 1:1 they'd previously been removed from.
    await db.query(
      `INSERT INTO channel_members (channel_id, user_id, last_read_seq)
       SELECT $1, unnest($2::text[]), (SELECT last_seq FROM channels WHERE id = $1)
       ON CONFLICT (channel_id, user_id) DO NOTHING`,
      [channelId, participants],
    );

    return { dto: await buildDmDTO(db, channelId, creatorId), created: wasCreated };
  });

  // Brand-new DM → dual-route to the OTHER participants so it appears in their
  // sidebar live (they may be anywhere — the user socket is cross-workspace).
  if (created) {
    const others = participants.filter((id) => id !== creatorId);
    await emitUserEvents(
      others.map((userId) => ({ userId, event: UserEvents.dmCreated(workspaceId, dto.id) })),
    );
  }
  return dto;
}

/**
 * The caller's direct & group messages, most-recently-active first.
 *
 * "Active" is the last message's timestamp, falling back to the channel's own
 * creation time for a DM nobody has written in yet. NOT `last_seq` — that's a
 * per-channel change COUNTER, so ordering by it ranked a long-idle 500-message
 * thread above a DM that just received its first message, and buried a
 * brand-new DM (`last_seq = 0`) at the very bottom where the recipient would
 * never notice it.
 */
export async function listDirectMessages(
  workspaceId: string,
  userId: string,
): Promise<DirectMessageDTO[]> {
  return withTenantSchema(workspaceId, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `SELECT c.id
         FROM channels c
         JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $1
        WHERE c.type IN ('direct', 'group') AND c.archived = false
        ORDER BY COALESCE(
                   (SELECT max(m.created_at) FROM messages m
                     WHERE m.channel_id = c.id AND m.deleted = false),
                   c.created_at
                 ) DESC,
                 c.created_at DESC`,
      [userId],
    );
    // Sequential (one PoolClient can't run queries concurrently).
    const dtos: DirectMessageDTO[] = [];
    for (const r of rows) dtos.push(await buildDmDTO(db, r.id, userId));
    return dtos;
  });
}
