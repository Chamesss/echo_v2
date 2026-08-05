import { and, eq } from "drizzle-orm";
import { controlDb } from "../../infrastructure/database/control/client.js";
import { memberships, users, workspaces } from "../../infrastructure/database/control/schema.js";
import { withTenantSchema } from "../../infrastructure/database/tenant/client.js";
import { emitWorkspaceEvent, RealtimeEvents } from "../../infrastructure/realtime/events.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../shared/errors/app-error.js";
import { ErrorCode } from "../../shared/errors/error-codes.js";
import { revokeWorkspaceNotifications } from "../notifications/notifications.service.js";
import { invalidateDirectory } from "./directory.service.js";

/**
 * Workspace membership management. The control plane owns the roster
 * (`memberships` + `users`); when someone is removed or leaves, we also strip
 * them from every channel in the workspace's tenant schema and drop their
 * notifications for the workspace, so access is revoked everywhere, not just at
 * the workspace boundary. (The workspace itself survives, so nothing cascades on
 * its behalf — see the LIFECYCLE note in `notifications.service.ts`.)
 *
 * The workspace OWNER (`workspaces.owner_id`) is protected: their role can't be
 * changed and they can't be removed or leave (ownership transfer is a separate,
 * later concern). This prevents orphaning the workspace's owner reference.
 */

export interface MemberDTO {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: "admin" | "member";
  isOwner: boolean;
}

async function getOwnerId(workspaceId: string): Promise<string> {
  const [ws] = await controlDb
    .select({ ownerId: workspaces.ownerId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!ws) throw new NotFoundError("Workspace not found", ErrorCode.NotFound);
  return ws.ownerId;
}

export async function listMembers(workspaceId: string): Promise<MemberDTO[]> {
  const ownerId = await getOwnerId(workspaceId);
  const rows = await controlDb
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.workspaceId, workspaceId))
    .orderBy(users.name);
  return rows.map((r) => ({ ...r, image: r.image ?? null, isOwner: r.userId === ownerId }));
}

export async function addMemberByEmail(
  workspaceId: string,
  input: { email: string; role: "admin" | "member" },
): Promise<MemberDTO> {
  const [user] = await controlDb
    .select()
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);
  if (!user) {
    throw new NotFoundError(
      "No account with that email — send them an invite instead",
      ErrorCode.UnknownUser,
    );
  }

  const [existing] = await controlDb
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, user.id)))
    .limit(1);
  if (existing) throw new ConflictError("Already a member", ErrorCode.AlreadyAMember);

  await controlDb.insert(memberships).values({ userId: user.id, workspaceId, role: input.role });
  invalidateDirectory(workspaceId);
  await emitWorkspaceEvent(workspaceId, RealtimeEvents.memberAdded(user.id, input.role));
  const ownerId = await getOwnerId(workspaceId);
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    image: user.image ?? null,
    role: input.role,
    isOwner: user.id === ownerId,
  };
}

export async function changeMemberRole(
  workspaceId: string,
  targetUserId: string,
  role: "admin" | "member",
): Promise<MemberDTO> {
  const ownerId = await getOwnerId(workspaceId);
  if (targetUserId === ownerId) {
    throw new ForbiddenError("The workspace owner's role can't be changed", ErrorCode.CannotModifyOwner);
  }

  const updated = await controlDb
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, targetUserId)))
    .returning({ userId: memberships.userId });
  if (!updated.length) throw new NotFoundError("Not a member of this workspace", ErrorCode.NotAMember);

  await emitWorkspaceEvent(workspaceId, RealtimeEvents.memberRoleChanged(targetUserId, role));

  const [user] = await controlDb.select().from(users).where(eq(users.id, targetUserId)).limit(1);
  return {
    userId: targetUserId,
    name: user!.name,
    email: user!.email,
    image: user!.image ?? null,
    role,
    isOwner: false,
  };
}

export async function removeMember(workspaceId: string, targetUserId: string): Promise<void> {
  const ownerId = await getOwnerId(workspaceId);
  if (targetUserId === ownerId) {
    throw new ForbiddenError("The workspace owner can't be removed", ErrorCode.CannotModifyOwner);
  }
  const deleted = await controlDb
    .delete(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, targetUserId)))
    .returning({ userId: memberships.userId });
  if (!deleted.length) throw new NotFoundError("Not a member of this workspace", ErrorCode.NotAMember);
  await removeFromAllChannels(workspaceId, targetUserId);
  await revokeWorkspaceNotifications(workspaceId, targetUserId);
  invalidateDirectory(workspaceId);
  await emitWorkspaceEvent(workspaceId, RealtimeEvents.memberRemoved(targetUserId));
}

export async function leaveWorkspace(workspaceId: string, userId: string): Promise<void> {
  const ownerId = await getOwnerId(workspaceId);
  if (userId === ownerId) {
    throw new BadRequestError(
      "The owner can't leave their own workspace",
      ErrorCode.CannotModifyOwner,
    );
  }
  const deleted = await controlDb
    .delete(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    .returning({ userId: memberships.userId });
  if (!deleted.length) {
    throw new NotFoundError("You are not a member of this workspace", ErrorCode.NotAMember);
  }
  await removeFromAllChannels(workspaceId, userId);
  await revokeWorkspaceNotifications(workspaceId, userId);
  invalidateDirectory(workspaceId);
  await emitWorkspaceEvent(workspaceId, RealtimeEvents.memberRemoved(userId));
}

/**
 * Announce a user's profile change (name/avatar) to every workspace they belong
 * to: drop the cached directory so the next read is fresh, and tell live clients
 * to re-read it — so author names/avatars (resolved from the directory) refresh
 * without a reload. Fired from the Better Auth `user.update` hook. Best-effort.
 */
export async function announceProfileUpdate(userId: string): Promise<void> {
  const rows = await controlDb
    .select({ workspaceId: memberships.workspaceId })
    .from(memberships)
    .where(eq(memberships.userId, userId));
  for (const { workspaceId } of rows) {
    invalidateDirectory(workspaceId);
    await emitWorkspaceEvent(workspaceId, RealtimeEvents.directoryUpdated());
  }
}

/** Strip a user from every channel in the workspace's tenant schema. */
async function removeFromAllChannels(workspaceId: string, userId: string): Promise<void> {
  await withTenantSchema(workspaceId, async (db) => {
    await db.query(`DELETE FROM channel_members WHERE user_id = $1`, [userId]);
  });
}
