import type { Request, Response } from "express";
import { logWorkspaceEvent, WorkspaceEventName } from "../../infrastructure/audit/audit-log.js";
import { emailService } from "../../infrastructure/email/email-service.js";
import { logger } from "../../shared/logger/logger.js";
import { getDirectory } from "./directory.service.js";
import * as invites from "./invites.service.js";
import * as members from "./members.service.js";
import type { AddMemberBody, ChangeRoleBody, CreateInviteBody } from "./members.dto.js";

/**
 * HTTP handlers for workspace membership + invitations.
 *
 * Workspace-scoped routes run behind `authenticate` + `loadWorkspace`; mutating
 * ones additionally behind `requireWorkspaceRole("admin")`. The accept routes
 * (getInvite/acceptInvite) run behind `authenticate` ONLY — invitees aren't
 * members yet, so they must not hit `loadWorkspace`.
 */

function actor(req: Request) {
  return { ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
}

export async function listMembersController(req: Request, res: Response): Promise<void> {
  res.json({ members: await members.listMembers(req.workspace.id) });
}

/** Cached `userId → {name,image}` directory for the workspace (member-level). */
export async function getDirectoryController(req: Request, res: Response): Promise<void> {
  res.json({ directory: await getDirectory(req.workspace.id) });
}

export async function addMemberController(req: Request, res: Response): Promise<void> {
  const body = req.body as AddMemberBody;
  const member = await members.addMemberByEmail(req.workspace.id, body);
  await logWorkspaceEvent({
    userId: req.user.id,
    workspaceId: req.workspace.id,
    event: WorkspaceEventName.MemberAdded,
    metadata: { targetUserId: member.userId, role: member.role, via: "add_by_email" },
    ...actor(req),
  });
  res.status(201).json(member);
}

export async function changeRoleController(req: Request, res: Response): Promise<void> {
  const body = req.body as ChangeRoleBody;
  const member = await members.changeMemberRole(req.workspace.id, req.params.userId!, body.role);
  await logWorkspaceEvent({
    userId: req.user.id,
    workspaceId: req.workspace.id,
    event: WorkspaceEventName.MemberRoleChanged,
    metadata: { targetUserId: member.userId, role: member.role },
    ...actor(req),
  });
  res.json(member);
}

export async function removeMemberController(req: Request, res: Response): Promise<void> {
  await members.removeMember(req.workspace.id, req.params.userId!);
  await logWorkspaceEvent({
    userId: req.user.id,
    workspaceId: req.workspace.id,
    event: WorkspaceEventName.MemberRemoved,
    metadata: { targetUserId: req.params.userId },
    ...actor(req),
  });
  res.status(204).end();
}

export async function leaveWorkspaceController(req: Request, res: Response): Promise<void> {
  await members.leaveWorkspace(req.workspace.id, req.user.id);
  await logWorkspaceEvent({
    userId: req.user.id,
    workspaceId: req.workspace.id,
    event: WorkspaceEventName.MemberLeft,
    ...actor(req),
  });
  res.status(204).end();
}

export async function listInvitesController(req: Request, res: Response): Promise<void> {
  res.json({ invites: await invites.listPendingInvites(req.workspace.id) });
}

export async function createInviteController(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateInviteBody;
  const invite = await invites.createInvite(req.workspace.id, req.user.id, body);

  // Best-effort send: the invite already exists in the DB, so an email failure
  // shouldn't fail the request (the admin can copy the link / re-send).
  try {
    await emailService.sendWorkspaceInvite({
      to: invite.email,
      workspaceName: req.workspace.slug,
      inviterName: req.user.name,
      url: invite.url,
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), email: invite.email },
      "Failed to send workspace invite email",
    );
  }

  await logWorkspaceEvent({
    userId: req.user.id,
    workspaceId: req.workspace.id,
    event: WorkspaceEventName.MemberInvited,
    metadata: { email: invite.email, role: invite.role },
    ...actor(req),
  });

  // The raw token is intentionally NOT returned — it only travels by email.
  res.status(201).json({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt,
  });
}

export async function getInviteController(req: Request, res: Response): Promise<void> {
  res.json(await invites.getInviteByToken(req.params.token!));
}

export async function acceptInviteController(req: Request, res: Response): Promise<void> {
  const result = await invites.acceptInvite(req.params.token!, {
    id: req.user.id,
    email: req.user.email,
  });
  await logWorkspaceEvent({
    userId: req.user.id,
    workspaceId: result.workspaceId,
    event: WorkspaceEventName.MemberAdded,
    metadata: { via: "invite" },
    ...actor(req),
  });
  res.json(result);
}
