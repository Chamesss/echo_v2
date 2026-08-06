import { withTenantSchema } from "../../infrastructure/database/tenant/client.js";
import {
  emitUserEvents,
  emitWorkspaceEvent,
  RealtimeEvents,
  UserEvents,
} from "../../infrastructure/realtime/events.js";
import { revokeChannelNotifications } from "../notifications/notifications.service.js";
import {
  assertCanManageChannel,
  assertChannelMember,
  assertGroupMember,
  loadChannelGate,
  type ChannelActor,
} from "./channels.gates.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../shared/errors/app-error.js";
import { ErrorCode } from "../../shared/errors/error-codes.js";

/**
 * Who is IN a channel, and their read position — leave, list, add, remove, and
 * the cursors behind "seen by".
 *
 * `joinChannel` stayed in `channels.service.ts`: it's the only membership op
 * returning a full `ChannelDTO`, so moving it would have meant exporting
 * `toDTO`/`CHANNEL_SELECT`/`ChannelRow` for one caller.
 */
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
