import type { Request, Response } from 'express';
import { logWorkspaceEvent, WorkspaceEventName } from '../../infrastructure/audit/audit-log.js';
import { ForbiddenError } from '../../shared/errors/app-error.js';
import { ErrorCode } from '../../shared/errors/error-codes.js';
import * as service from './workspaces.service.js';
import type { CreateWorkspaceBody, UpdateWorkspaceBody } from './workspaces.dto.js';

/**
 * Handles `POST /api/workspaces`.
 *
 * Mounted behind `authenticate` + `validate(createWorkspaceBody)` +
 * `asyncHandler` in `workspaces.routes.ts`. By the time we get here:
 *   - `req.user.id` is the authenticated caller (becomes the new workspace's owner)
 *   - `req.body` is parsed + typed as `CreateWorkspaceBody`
 */
export async function createWorkspaceController(
  req: Request,
  res: Response,
): Promise<void> {
  const body = req.body as CreateWorkspaceBody;
  const result = await service.createWorkspace(req.user.id, body);
  res.status(201).json(result);
}

/**
 * Handles `GET /api/workspaces`.
 *
 * Mounted behind `authenticate` in `workspaces.routes.ts`. Returns every
 * workspace the caller belongs to. The frontend hits this right after
 * sign-in to decide between /workspaces/create (empty list) and
 * /dashboard/:id (any membership).
 */
export async function listMyWorkspacesController(
  req: Request,
  res: Response,
): Promise<void> {
  const list = await service.listMyWorkspaces(req.user.id);
  res.json(list);
}

/**
 * Handles `GET /api/workspaces/:workspaceId`.
 *
 * Mounted behind `authenticate` + `loadWorkspace` in `workspaces.routes.ts`.
 * The middleware chain has already verified membership and attached
 * `req.workspace`, so this is a pure passthrough — no service call needed
 * for a read this simple.
 */
export function getWorkspaceController(req: Request, res: Response): void {
  res.json(req.workspace);
}

/**
 * Handles `PATCH /api/workspaces/:workspaceId` — rename (admin-only, gated by
 * `requireWorkspaceRole('admin')` in the router). Returns the workspace in the
 * same shape `GET` does so the client can refresh its cache.
 */
export async function updateWorkspaceController(req: Request, res: Response): Promise<void> {
  const { name } = req.body as UpdateWorkspaceBody;
  const updated = await service.renameWorkspace(req.workspace.id, name);
  await logWorkspaceEvent({
    userId: req.user.id,
    workspaceId: req.workspace.id,
    event: WorkspaceEventName.WorkspaceRenamed,
    metadata: { name },
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  });
  res.json({ ...updated, role: req.workspace.role, isOwner: req.workspace.isOwner });
}

/**
 * Handles `DELETE /api/workspaces/:workspaceId` — permanent deletion + tenant
 * schema teardown. OWNER-ONLY: deleting a workspace is the most destructive
 * action, so even a non-owner admin can't do it.
 */
export async function deleteWorkspaceController(req: Request, res: Response): Promise<void> {
  if (!req.workspace.isOwner) {
    throw new ForbiddenError(
      'Only the workspace owner can delete it',
      ErrorCode.NotWorkspaceOwner,
    );
  }
  await service.deleteWorkspace(req.workspace.id);
  await logWorkspaceEvent({
    userId: req.user.id,
    workspaceId: req.workspace.id,
    event: WorkspaceEventName.WorkspaceDeleted,
    metadata: { slug: req.workspace.slug },
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  });
  res.status(204).end();
}
