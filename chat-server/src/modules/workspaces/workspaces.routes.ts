import { Router } from 'express';
import { validate } from '../../shared/middleware/validate.js';
import { asyncHandler } from '../../shared/middleware/async-handler.js';
import { loadWorkspace } from '../../shared/middleware/load-workspace.js';
import { channelsRouter } from '../channels/channels.routes.js';
import { createWorkspaceBody } from './workspaces.dto.js';
import {
  createWorkspaceController,
  getWorkspaceController,
  listMyWorkspacesController,
} from './workspaces.controller.js';

/**
 * Workspace route table.
 *
 * Mounted at `/api/workspaces` in `app.ts` behind the `authenticate`
 * middleware — every route in this router assumes `req.user` is present.
 *
 * Order matters: collection-level routes (`GET /`, `POST /`) MUST be
 * registered before `router.use('/:workspaceId', loadWorkspace)`, otherwise
 * `loadWorkspace` would try to look up a workspace from a non-UUID path
 * (or worse, treat `/` as `:workspaceId === ''`).
 *
 * Layout:
 *   GET  /                  → list caller's workspaces
 *   POST /                  → create workspace
 *   /:workspaceId/*         → membership-checked by `loadWorkspace`
 *
 * When channels / messages modules land, they'll mount under
 * `/:workspaceId/channels` and `/:workspaceId/messages` and inherit the same
 * membership check for free.
 */
export const workspacesRouter = Router();

workspacesRouter.get('/', asyncHandler(listMyWorkspacesController));

workspacesRouter.post(
  '/',
  validate({ body: createWorkspaceBody }),
  asyncHandler(createWorkspaceController),
);

workspacesRouter.use('/:workspaceId', loadWorkspace);

workspacesRouter.get('/:workspaceId', getWorkspaceController);

// Channels + messages inherit the `loadWorkspace` membership check above.
workspacesRouter.use('/:workspaceId/channels', channelsRouter);
