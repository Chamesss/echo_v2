import type { Request, Response } from 'express';
import * as service from './workspaces.service.js';
import type { CreateWorkspaceBody } from './workspaces.dto.js';

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
