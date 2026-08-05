import type { PoolClient } from "pg";
import { withTenantSchema } from "../../infrastructure/database/tenant/client.js";
import {
  emitUserEvents,
  emitWorkspaceEvent,
  RealtimeEvents,
  UserEvents,
} from "../../infrastructure/realtime/events.js";
import { revokeChannelNotifications } from "../notifications/notifications.service.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../shared/errors/app-error.js";
import { ErrorCode } from "../../shared/errors/error-codes.js";
import type { CreateChannelBody } from "./channels.dto.js";

/**
 * Channel business logic. All persistence runs through `withTenantSchema`, so
 * unqualified table names resolve to the caller's workspace schema. The control
 * tables (`users`, `memberships`) live in `public`, which is also on the
 * search_path, so a tenant query can join to them directly.
 *
 * Access model: participating in a channel — reading, subscribing, posting —
 * requires a `channel_members` row. Public channels are open-join; private
 * channels are managed (members are added by a channel member). MANAGEMENT of a
 * channel (rename / set topic / archive / delete / remove members) requires
 * being a workspace admin OR the channel's creator.
 */
export interface ChannelDTO {
  id: string;
  type: "public" | "private" | "direct" | "group";
  name: string | null;
  topic: string | null;
  archived: boolean;
  createdBy: string | null;
  lastSeq: number;
  isMember: boolean;
  unread: number;
  createdAt: string;
}

interface ChannelRow {
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
}

/** Columns + membership computed against `$1 = userId`, shared by the read queries. */
const CHANNEL_SELECT = `
  c.id, c.type, c.name, c.topic, c.archived, c.created_by, c.last_seq, c.created_at,
  cm.last_read_seq,
  (cm.user_id IS NOT NULL) AS is_member`;

/** Actor context for management operations. */
export interface ChannelActor {
  userId: string;
  isWorkspaceAdmin: boolean;
}

function toDTO(row: ChannelRow): ChannelDTO {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    topic: row.topic,
    archived: row.archived,
    createdBy: row.created_by,
    lastSeq: row.last_seq,
    isMember: row.is_member,
    unread: row.is_member ? Math.max(0, row.last_seq - (row.last_read_seq ?? 0)) : 0,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Named channels the user can see: every public channel + private ones they're
 * in. Hides archived. DMs (`direct`/`group`) are intentionally excluded — they
 * have their own listing (see `dm.service.ts#listDirectMessages`).
 */
export async function listChannels(workspaceId: string, userId: string): Promise<ChannelDTO[]> {
  return withTenantSchema(workspaceId, async (db) => {
    const { rows } = await db.query<ChannelRow>(
      `SELECT ${CHANNEL_SELECT}
         FROM channels c
         LEFT JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $1
        WHERE c.archived = false
          AND c.type IN ('public', 'private')
          AND (c.type = 'public' OR cm.user_id IS NOT NULL)
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
  const channel = await withTenantSchema(workspaceId, async (db) => {
    const { rows } = await db.query<ChannelRow>(
      `INSERT INTO channels (type, name, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, type, name, topic, archived, created_by, last_seq, created_at,
                 0 AS last_read_seq, true AS is_member`,
      [input.type, input.name, userId],
    );
    const row = rows[0]!;
    await db.query(`INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)`, [
      row.id,
      userId,
    ]);
    return toDTO(row);
  });

  // Tell the workspace a channel now exists so live clients show it without a
  // reload (a private channel's id is harmless to broadcast — non-members' list
  // refetch won't include it).
  await emitWorkspaceEvent(workspaceId, RealtimeEvents.channelCreated(channel.id));
  return channel;
}

/** Open-join a public channel. Private channels are managed (403); archived channels can't be joined. */
export async function joinChannel(
  workspaceId: string,
  userId: string,
  channelId: string,
): Promise<ChannelDTO> {
  const channel = await withTenantSchema(workspaceId, async (db) => {
    const { rows } = await db.query<ChannelRow>(
      `SELECT c.id, c.type, c.name, c.topic, c.archived, c.created_by, c.last_seq, c.created_at,
              NULL::int AS last_read_seq, false AS is_member
         FROM channels c WHERE c.id = $1`,
      [channelId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("Channel not found", ErrorCode.ChannelNotFound);
    if (row.archived) {
      throw new ForbiddenError("This channel is archived", ErrorCode.ChannelArchived);
    }
    if (row.type !== "public") {
      throw new ForbiddenError("This channel is invite-only", ErrorCode.NotAChannelMember);
    }
    // Start the joiner caught up to the join point — they didn't "miss" the
    // pre-existing history, so it shouldn't show as unread. Only messages sent
    // after they join count toward their unread.
    await db.query(
      `INSERT INTO channel_members (channel_id, user_id, last_read_seq) VALUES ($1, $2, $3)
       ON CONFLICT (channel_id, user_id) DO NOTHING`,
      [channelId, userId, row.last_seq],
    );
    return toDTO({ ...row, is_member: true, last_read_seq: row.last_seq });
  });

  // Member set changed → others re-read the channel's member list.
  await emitWorkspaceEvent(workspaceId, RealtimeEvents.channelUpdated(channelId));
  return channel;
}

export async function getChannel(
  workspaceId: string,
  userId: string,
  channelId: string,
): Promise<ChannelDTO> {
  return withTenantSchema(workspaceId, async (db) => {
    const { rows } = await db.query<ChannelRow>(
      `SELECT ${CHANNEL_SELECT}
         FROM channels c
         LEFT JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $2
        WHERE c.id = $1`,
      [channelId, userId],
    );
    const channel = rows[0];
    if (!channel) throw new NotFoundError("Channel not found", ErrorCode.ChannelNotFound);
    // Only public channels are visible to non-members; private channels and DMs
    // (direct/group) require a membership row.
    if (channel.type !== "public" && !channel.is_member) {
      throw new ForbiddenError("You don't have access to this channel", ErrorCode.NotAChannelMember);
    }
    return toDTO(channel);
  });
}

// ─── Management ─────────────────────────────────────────────────────────────

/**
 * A channel's type plus the actor's standing in it — the inputs every
 * management rule needs.
 *
 * Named channels and conversations answer to different authorities. A channel is
 * an organisational object: workspace admins own it whether or not they've
 * joined. A DM is not — it belongs to the people in it, so a workspace role
 * grants nothing. Routing DMs through the channel rule is what let an admin
 * delete or archive a conversation they could not even read (`getChannel`
 * blocks non-members, but the management path never consulted membership).
 */
interface ChannelGate {
  type: "public" | "private" | "direct" | "group";
  createdBy: string | null;
  isMember: boolean;
}

async function loadChannelGate(
  db: PoolClient,
  channelId: string,
  userId: string,
): Promise<ChannelGate> {
  const { rows } = await db.query<{
    type: ChannelGate["type"];
    created_by: string | null;
    is_member: boolean;
  }>(
    `SELECT c.type, c.created_by, (cm.user_id IS NOT NULL) AS is_member
       FROM channels c
       LEFT JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $2
      WHERE c.id = $1`,
    [channelId, userId],
  );
  const row = rows[0];
  if (!row) throw new NotFoundError("Channel not found", ErrorCode.ChannelNotFound);
  return { type: row.type, createdBy: row.created_by, isMember: row.is_member };
}

/** True for the two conversation types, which are never workspace-managed. */
function isConversation(type: ChannelGate["type"]): boolean {
  return type === "direct" || type === "group";
}

/**
 * Assert the actor may manage a GROUP conversation: membership, nothing else.
 *
 * There is no per-channel role in the schema, so `created_by` is the only
 * distinguishing attribute available. Any member may rename it or add people;
 * only the creator may remove someone else. Anyone may remove themselves —
 * that's `leaveChannel`.
 */
function assertGroupMember(gate: ChannelGate): void {
  if (!gate.isMember) {
    throw new ForbiddenError(
      "You're not part of this conversation",
      ErrorCode.NotAChannelMember,
    );
  }
}

/** Fetch a channel and assert the actor may manage it (workspace admin OR creator). */
async function assertCanManageChannel(
  db: PoolClient,
  channelId: string,
  actor: ChannelActor,
): Promise<void> {
  const { rows } = await db.query<{ created_by: string | null }>(
    `SELECT created_by FROM channels WHERE id = $1`,
    [channelId],
  );
  const channel = rows[0];
  if (!channel) throw new NotFoundError("Channel not found", ErrorCode.ChannelNotFound);
  if (actor.isWorkspaceAdmin || channel.created_by === actor.userId) return;
  throw new ForbiddenError(
    "Only the channel creator or a workspace admin can manage this channel",
    ErrorCode.CannotManageChannel,
  );
}

export interface UpdateChannelInput {
  /** `null` clears it — groups only, restoring their participant-derived label. */
  name?: string | null;
  topic?: string | null;
  archived?: boolean;
}

/** Rename / set topic / archive a channel. */
export async function updateChannel(
  workspaceId: string,
  channelId: string,
  actor: ChannelActor,
  input: UpdateChannelInput,
): Promise<ChannelDTO> {
  const channel = await withTenantSchema(workspaceId, async (db) => {
    const gate = await loadChannelGate(db, channelId, actor.userId);
    if (gate.type === "direct") {
      // A 1:1 is labelled by who's in it; there is nothing to rename, and
      // archiving would hide it from both people with no way back.
      throw new ForbiddenError(
        "Direct messages can't be renamed or archived",
        ErrorCode.NotAllowedOnConversation,
      );
    }
    if (gate.type === "group") {
      assertGroupMember(gate);
      if (input.archived !== undefined) {
        // Archiving drops a conversation out of BOTH list endpoints while
        // leaving it readable by id, with no UI to bring it back. Leaving is
        // the exit from a group.
        throw new ForbiddenError(
          "Conversations can't be archived — leave it instead",
          ErrorCode.NotAllowedOnConversation,
        );
      }
    } else {
      await assertCanManageChannel(db, channelId, actor);
      if (input.name === null) {
        // Only a group has a name to fall back FROM.
        throw new BadRequestError("A channel needs a name", ErrorCode.BadRequest);
      }
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.name !== undefined) sets.push(`name = $${params.push(input.name)}`);
    if (input.topic !== undefined) sets.push(`topic = $${params.push(input.topic)}`);
    if (input.archived !== undefined) sets.push(`archived = $${params.push(input.archived)}`);
    // The DTO guarantees at least one field, so `sets` is never empty.

    // Membership / read-state for the returned DTO is computed against the actor.
    const actorParam = params.push(actor.userId);
    const idParam = params.push(channelId);

    const { rows } = await db.query<ChannelRow>(
      `WITH updated AS (
         UPDATE channels AS c SET ${sets.join(", ")} WHERE c.id = $${idParam}
         RETURNING c.id, c.type, c.name, c.topic, c.archived, c.created_by, c.last_seq, c.created_at
       )
       SELECT u.id, u.type, u.name, u.topic, u.archived, u.created_by, u.last_seq, u.created_at,
              cm.last_read_seq, (cm.user_id IS NOT NULL) AS is_member
         FROM updated u
         LEFT JOIN channel_members cm ON cm.channel_id = u.id AND cm.user_id = $${actorParam}`,
      params,
    );
    return toDTO(rows[0]!);
  });

  // Name/topic/archived changed → live clients re-read the channel.
  await emitWorkspaceEvent(workspaceId, RealtimeEvents.channelUpdated(channel.id));
  return channel;
}

/** Hard-delete a channel (cascades messages, members, revisions, attachments). */
export async function deleteChannel(
  workspaceId: string,
  channelId: string,
  actor: ChannelActor,
): Promise<void> {
  await withTenantSchema(workspaceId, async (db) => {
    const gate = await loadChannelGate(db, channelId, actor.userId);
    if (isConversation(gate.type)) {
      // Nobody deletes a conversation — not the other participant, and not a
      // workspace admin, who can't even read it. Leaving is the exit.
      throw new ForbiddenError(
        "Conversations can't be deleted",
        ErrorCode.NotAllowedOnConversation,
      );
    }
    await assertCanManageChannel(db, channelId, actor);
    await db.query(`DELETE FROM channels WHERE id = $1`, [channelId]);
  });

  // The channel's rows cascade inside the tenant schema, but notifications live
  // in the control plane with no FK to them — nobody can open this channel now,
  // so nobody should still have an inbox entry pointing at it.
  await revokeChannelNotifications(channelId);

  // Drop it from every live client's list (and bounce anyone viewing it).
  await emitWorkspaceEvent(workspaceId, RealtimeEvents.channelDeleted(channelId));
}

/** Leave a channel (any current member; removes only their own membership). */
export async function leaveChannel(
  workspaceId: string,
  userId: string,
  channelId: string,
): Promise<void> {
  await withTenantSchema(workspaceId, async (db) => {
    const gate = await loadChannelGate(db, channelId, userId);
    if (gate.type === "direct") {
      // Leaving a 1:1 would strand the other person in a conversation whose
      // key still names you, and there is no "close/hide" concept to fall back
      // on. The member set of a 1:1 is fixed for its whole life.
      throw new ForbiddenError(
        "You can't leave a direct message",
        ErrorCode.NotAllowedOnConversation,
      );
    }
    await assertChannelMember(db, channelId, userId);
    await db.query(`DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2`, [
      channelId,
      userId,
    ]);
  });

  // Their inbox shouldn't keep entries for a conversation they just left — the
  // "View" on each one would land on "Channel not found".
  await revokeChannelNotifications(channelId, userId);

  // Member set changed → re-read the channel (the leaver's own list drops it too).
  await emitWorkspaceEvent(workspaceId, RealtimeEvents.channelUpdated(channelId));
  // ...and drop the leaver's live subscription, so the socket stops delivering
  // this channel's messages without waiting for their client to unsubscribe.
  await emitWorkspaceEvent(workspaceId, RealtimeEvents.channelMemberRemoved(channelId, userId));
}

export interface ChannelMemberDTO {
  userId: string;
  name: string;
  email: string;
  image: string | null;
}

/** List a channel's members (must be a member to view). */
export async function listChannelMembers(
  workspaceId: string,
  userId: string,
  channelId: string,
): Promise<ChannelMemberDTO[]> {
  return withTenantSchema(workspaceId, async (db) => {
    await assertChannelMember(db, channelId, userId);
    const { rows } = await db.query<{
      user_id: string;
      name: string;
      email: string;
      image: string | null;
    }>(
      `SELECT cm.user_id, u.name, u.email, u.image
         FROM channel_members cm
         JOIN users u ON u.id = cm.user_id
        WHERE cm.channel_id = $1
        ORDER BY u.name`,
      [channelId],
    );
    return rows.map((r) => ({
      userId: r.user_id,
      name: r.name,
      email: r.email,
      image: r.image ?? null,
    }));
  });
}

/** Add a workspace member to a channel. Any channel member may add others. */
export async function addChannelMember(
  workspaceId: string,
  channelId: string,
  actorUserId: string,
  targetUserId: string,
): Promise<void> {
  await withTenantSchema(workspaceId, async (db) => {
    const gate = await loadChannelGate(db, channelId, actorUserId);
    if (gate.type === "direct") {
      // The privacy rule. A 1:1 is identified by its `dm_key`, and adding a
      // third person here would leave that key naming only two of them — so the
      // next "message Bob" would silently reopen this room with the extra
      // person still in it. The client starts a NEW group instead.
      throw new BadRequestError(
        "You can't add someone to a direct message — start a group conversation instead",
        ErrorCode.DirectMessageIsFixed,
      );
    }
    await assertChannelMember(db, channelId, actorUserId);
    const { rows } = await db.query<{ ok: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM memberships WHERE workspace_id = $1 AND user_id = $2) AS ok`,
      [workspaceId, targetUserId],
    );
    if (!rows[0]!.ok) {
      throw new NotFoundError("That user isn't a member of this workspace", ErrorCode.NotAMember);
    }
    // Caught up to when they were added — pre-existing history isn't "unread".
    await db.query(
      `INSERT INTO channel_members (channel_id, user_id, last_read_seq)
       SELECT $1, $2, last_seq FROM channels WHERE id = $1
       ON CONFLICT (channel_id, user_id) DO NOTHING`,
      [channelId, targetUserId],
    );
  });

  // Dual-route to the added user so the channel appears in their list even from
  // the dashboard / another workspace; broadcast so member-list viewers re-read.
  await emitUserEvents([
    { userId: targetUserId, event: UserEvents.channelAdded(workspaceId, channelId) },
  ]);
  await emitWorkspaceEvent(workspaceId, RealtimeEvents.channelUpdated(channelId));
}

/** Remove a member from a channel (admin or creator). */
export async function removeChannelMember(
  workspaceId: string,
  channelId: string,
  actor: ChannelActor,
  targetUserId: string,
): Promise<void> {
  await withTenantSchema(workspaceId, async (db) => {
    const gate = await loadChannelGate(db, channelId, actor.userId);
    if (gate.type === "direct") {
      throw new ForbiddenError(
        "A direct message's participants can't be changed",
        ErrorCode.NotAllowedOnConversation,
      );
    }
    if (gate.type === "group") {
      // No per-channel roles exist, so `created_by` is the only authority a
      // group has. Anyone may remove THEMSELVES — that path is `leaveChannel`.
      assertGroupMember(gate);
      if (gate.createdBy !== actor.userId && targetUserId !== actor.userId) {
        throw new ForbiddenError(
          "Only the person who started this conversation can remove someone",
          ErrorCode.CannotManageChannel,
        );
      }
    } else {
      await assertCanManageChannel(db, channelId, actor);
    }
    await db.query(`DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2`, [
      channelId,
      targetUserId,
    ]);
  });

  // Same as `leaveChannel`: access ended, so the inbox entries that point here
  // have to go with it.
  await revokeChannelNotifications(channelId, targetUserId);

  // Dual-route to the removed user so they lose it live (and get bounced out if
  // viewing it); broadcast so member-list viewers re-read.
  await emitUserEvents([
    { userId: targetUserId, event: UserEvents.channelRemoved(workspaceId, channelId) },
  ]);
  await emitWorkspaceEvent(workspaceId, RealtimeEvents.channelUpdated(channelId));
  // Revoke their live subscription server-side rather than trusting their client
  // to unsubscribe itself — see `hub.revokeChannel`.
  await emitWorkspaceEvent(
    workspaceId,
    RealtimeEvents.channelMemberRemoved(channelId, targetUserId),
  );
}

export interface ChannelReadDTO {
  userId: string;
  lastReadSeq: number;
}

/**
 * Every member's read cursor for a channel — the basis for "seen by" receipts.
 * A message with creation ordinal `seq` is seen by a user iff their
 * `lastReadSeq >= seq`. Requires channel membership; names/avatars are resolved
 * client-side from the member directory.
 */
export async function getChannelReads(
  workspaceId: string,
  userId: string,
  channelId: string,
): Promise<ChannelReadDTO[]> {
  return withTenantSchema(workspaceId, async (db) => {
    await assertChannelMember(db, channelId, userId);
    const { rows } = await db.query<{ user_id: string; last_read_seq: number }>(
      `SELECT user_id, last_read_seq FROM channel_members WHERE channel_id = $1`,
      [channelId],
    );
    return rows.map((r) => ({ userId: r.user_id, lastReadSeq: r.last_read_seq }));
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
