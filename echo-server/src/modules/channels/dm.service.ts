import type { PoolClient } from "pg";
import { withTenantSchema } from "../../infrastructure/database/tenant/client.js";
import { emitUserEvents, UserEvents } from "../../infrastructure/realtime/events.js";
import { BadRequestError, NotFoundError } from "../../shared/errors/app-error.js";
import { ErrorCode } from "../../shared/errors/error-codes.js";
import type { ChannelDTO } from "./channels.service.js";

/**
 * Direct & group messages. A DM is just a `channels` row of type `direct` (2
 * people) or `group` (3+), addressed by a canonical `dm_key` derived from the
 * sorted participant set — so "open a DM with X" is idempotent: the same set of
 * people always resolves to the same channel (the `dm_key` unique index
 * enforces it even under a race). Messaging/edit/catch-up reuse the channel
 * engine unchanged; only open-or-create + listing live here.
 */

export interface DmParticipant {
  userId: string;
  name: string;
  image: string | null;
}

/** A DM is a channel plus its participants; `name` is a label of the others. */
export interface DirectMessageDTO extends ChannelDTO {
  participants: DmParticipant[];
}

/** Order-independent key for a participant set. */
function dmKey(userIds: string[]): string {
  return [...new Set(userIds)].sort().join(":");
}

/** Display label = the OTHER participants' names (falls back to all for a self-DM edge). */
function label(participants: DmParticipant[], selfId: string): string {
  const others = participants.filter((p) => p.userId !== selfId);
  return (others.length ? others : participants).map((p) => p.name).join(", ");
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
    topic: string | null;
    archived: boolean;
    created_by: string | null;
    last_seq: number;
    created_at: Date;
    last_read_seq: number | null;
    is_member: boolean;
  }>(
    `SELECT c.id, c.type, c.topic, c.archived, c.created_by, c.last_seq, c.created_at,
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
    name: label(participants, selfId),
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
 * Open (or create) a DM with the given other users. Idempotent on the
 * participant set. All participants must be members of the workspace.
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
  const key = dmKey(participants);
  const type = participants.length === 2 ? "direct" : "group";

  const { dto, created } = await withTenantSchema(workspaceId, async (db) => {
    // Every participant must be a workspace member (public.memberships via search_path).
    const { rows: count } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM memberships WHERE workspace_id = $1 AND user_id = ANY($2::text[])`,
      [workspaceId, participants],
    );
    if (count[0]!.n !== participants.length) {
      throw new NotFoundError("All participants must be workspace members", ErrorCode.NotAMember);
    }

    // Open-or-create: the dm_key unique index makes this safe under concurrency.
    // A returned row means we created it (vs. resolving an existing DM) — only a
    // brand-new DM should notify the other participants.
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO channels (type, dm_key, created_by) VALUES ($1, $2, $3)
       ON CONFLICT (dm_key) DO NOTHING RETURNING id`,
      [type, key, creatorId],
    );
    const wasCreated = inserted.rows.length > 0;
    const channelId =
      inserted.rows[0]?.id ??
      (await db.query<{ id: string }>(`SELECT id FROM channels WHERE dm_key = $1`, [key])).rows[0]!
        .id;

    // Seed/ensure membership for all participants (idempotent).
    await db.query(
      `INSERT INTO channel_members (channel_id, user_id)
       SELECT $1, unnest($2::text[]) ON CONFLICT (channel_id, user_id) DO NOTHING`,
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

/** The caller's direct & group messages, most-recently-active first. */
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
        ORDER BY c.last_seq DESC, c.created_at DESC`,
      [userId],
    );
    // Sequential (one PoolClient can't run queries concurrently).
    const dtos: DirectMessageDTO[] = [];
    for (const r of rows) dtos.push(await buildDmDTO(db, r.id, userId));
    return dtos;
  });
}
