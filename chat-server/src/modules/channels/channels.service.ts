import type { PoolClient } from "pg";
import { withTenantSchema } from "../../infrastructure/database/tenant/client.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors/app-error.js";
import { ErrorCode } from "../../shared/errors/error-codes.js";
import type { CreateChannelBody } from "./channels.dto.js";

/**
 * Channel business logic. All persistence runs through `withTenantSchema`, so
 * the unqualified table names resolve to the caller's workspace schema.
 *
 * Access model (v1): participating in a channel — reading, subscribing over the
 * socket, posting — requires a `channel_members` row. Public channels are
 * open-join (any workspace member); private channels are invite-only (members
 * are seeded at creation; an invite flow lands with the DMs follow-up).
 */
export interface ChannelDTO {
  id: string;
  type: "public" | "private" | "direct" | "group";
  name: string | null;
  lastSeq: number;
  isMember: boolean;
  unread: number;
  createdAt: string;
}

interface ChannelRow {
  id: string;
  type: ChannelDTO["type"];
  name: string | null;
  last_seq: number;
  created_at: Date;
  last_read_seq: number | null;
  is_member: boolean;
}

function toDTO(row: ChannelRow): ChannelDTO {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    lastSeq: row.last_seq,
    isMember: row.is_member,
    unread: row.is_member ? Math.max(0, row.last_seq - (row.last_read_seq ?? 0)) : 0,
    createdAt: row.created_at.toISOString(),
  };
}

/** Channels the user can see: every public channel + private ones they're in. */
export async function listChannels(workspaceId: string, userId: string): Promise<ChannelDTO[]> {
  return withTenantSchema(workspaceId, async (db) => {
    const { rows } = await db.query<ChannelRow>(
      `SELECT c.id, c.type, c.name, c.last_seq, c.created_at,
              cm.last_read_seq,
              (cm.user_id IS NOT NULL) AS is_member
         FROM channels c
         LEFT JOIN channel_members cm
           ON cm.channel_id = c.id AND cm.user_id = $1
        WHERE c.type = 'public' OR cm.user_id IS NOT NULL
        ORDER BY c.created_at ASC, c.id ASC`,
      [userId],
    );
    return rows.map(toDTO);
  });
}

export async function createChannel(
  workspaceId: string,
  userId: string,
  input: CreateChannelBody,
): Promise<ChannelDTO> {
  return withTenantSchema(workspaceId, async (db) => {
    const { rows } = await db.query<ChannelRow>(
      `INSERT INTO channels (type, name)
       VALUES ($1, $2)
       RETURNING id, type, name, last_seq, created_at, 0 AS last_read_seq, true AS is_member`,
      [input.type, input.name],
    );
    const channel = rows[0]!;
    await db.query(`INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)`, [
      channel.id,
      userId,
    ]);
    return toDTO(channel);
  });
}

/** Open-join a public channel. Private channels are invite-only (403). */
export async function joinChannel(
  workspaceId: string,
  userId: string,
  channelId: string,
): Promise<ChannelDTO> {
  return withTenantSchema(workspaceId, async (db) => {
    const { rows } = await db.query<ChannelRow>(
      `SELECT id, type, name, last_seq, created_at, NULL::int AS last_read_seq, false AS is_member
         FROM channels WHERE id = $1`,
      [channelId],
    );
    const channel = rows[0];
    if (!channel) throw new NotFoundError("Channel not found", ErrorCode.ChannelNotFound);
    if (channel.type !== "public") {
      throw new ForbiddenError("This channel is invite-only", ErrorCode.NotAChannelMember);
    }
    await db.query(
      `INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)
       ON CONFLICT (channel_id, user_id) DO NOTHING`,
      [channelId, userId],
    );
    return toDTO({ ...channel, is_member: true, last_read_seq: 0 });
  });
}

export async function getChannel(
  workspaceId: string,
  userId: string,
  channelId: string,
): Promise<ChannelDTO> {
  return withTenantSchema(workspaceId, async (db) => {
    const { rows } = await db.query<ChannelRow>(
      `SELECT c.id, c.type, c.name, c.last_seq, c.created_at,
              cm.last_read_seq, (cm.user_id IS NOT NULL) AS is_member
         FROM channels c
         LEFT JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $2
        WHERE c.id = $1`,
      [channelId, userId],
    );
    const channel = rows[0];
    if (!channel) throw new NotFoundError("Channel not found", ErrorCode.ChannelNotFound);
    if (channel.type === "private" && !channel.is_member) {
      throw new ForbiddenError("You don't have access to this channel", ErrorCode.NotAChannelMember);
    }
    return toDTO(channel);
  });
}

/**
 * Throws unless `userId` is a member of `channelId` — the gate for posting,
 * reading messages, and subscribing over the socket. Use the in-transaction
 * variant inside the messaging engine to avoid a second round-trip.
 */
export async function assertChannelMember(
  db: PoolClient,
  channelId: string,
  userId: string,
): Promise<void> {
  const { rows } = await db.query<{ channel_exists: boolean; is_member: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM channels WHERE id = $1) AS channel_exists,
            EXISTS(SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2) AS is_member`,
    [channelId, userId],
  );
  const check = rows[0]!;
  if (!check.channel_exists) throw new NotFoundError("Channel not found", ErrorCode.ChannelNotFound);
  if (!check.is_member) {
    throw new ForbiddenError("You are not a member of this channel", ErrorCode.NotAChannelMember);
  }
}

/** Standalone membership gate (own transaction) for the WS subscribe path. */
export async function assertChannelAccess(
  workspaceId: string,
  userId: string,
  channelId: string,
): Promise<void> {
  await withTenantSchema(workspaceId, (db) => assertChannelMember(db, channelId, userId));
}
