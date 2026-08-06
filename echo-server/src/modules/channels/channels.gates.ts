import type { PoolClient } from "pg";
import { withTenantSchema } from "../../infrastructure/database/tenant/client.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors/app-error.js";
import { ErrorCode } from "../../shared/errors/error-codes.js";

/**
 * Every authorization rule for channels and conversations — the file to read when
 * the question is "who may do what".
 *
 * Also breaks a knot: `messages.service` needed `assertChannelMember` from
 * `channels.service`, which reached into `notifications.service`. These depend
 * only on the tenant client and the error types.
 */

/** Actor context for management operations. */
export interface ChannelActor {
  userId: string;
  isWorkspaceAdmin: boolean;
}

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

export async function loadChannelGate(
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
export function isConversation(type: ChannelGate["type"]): boolean {
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
export function assertGroupMember(gate: ChannelGate): void {
  if (!gate.isMember) {
    throw new ForbiddenError(
      "You're not part of this conversation",
      ErrorCode.NotAChannelMember,
    );
  }
}

/** Fetch a channel and assert the actor may manage it (workspace admin OR creator). */
export async function assertCanManageChannel(
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
