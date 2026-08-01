import { Router } from "express";
import { validate } from "../../shared/middleware/validate.js";
import { asyncHandler } from "../../shared/middleware/async-handler.js";
import { loadWorkspace } from "../../shared/middleware/load-workspace.js";
import { requireWorkspaceRole } from "../../shared/middleware/require-workspace-role.js";
import { channelsRouter } from "../channels/channels.routes.js";
import { dmsRouter } from "../channels/dm.routes.js";
import { membersRouter } from "../members/members.routes.js";
import { invitesRouter } from "../members/invites.routes.js";
import {
  leaveWorkspaceController,
  getDirectoryController,
  getPresenceController,
} from "../members/members.controller.js";
import { createWorkspaceBody, updateWorkspaceBody } from "./workspaces.dto.js";
import {
  createWorkspaceController,
  deleteWorkspaceController,
  getWorkspaceController,
  listMyWorkspacesController,
  updateWorkspaceController,
} from "./workspaces.controller.js";

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

workspacesRouter.get("/", asyncHandler(listMyWorkspacesController));

workspacesRouter.post(
  "/",
  validate({ body: createWorkspaceBody }),
  asyncHandler(createWorkspaceController),
);

workspacesRouter.use("/:workspaceId", loadWorkspace);

// Cached member directory (name/avatar) — any member may read.
workspacesRouter.get(
  "/:workspaceId/directory",
  asyncHandler(getDirectoryController),
);

// Who's online right now — same audience as the directory.
workspacesRouter.get(
  "/:workspaceId/presence",
  asyncHandler(getPresenceController),
);

workspacesRouter.get("/:workspaceId", getWorkspaceController);

// Rename is admin-only; delete is owner-only (checked inside the controller).
workspacesRouter.patch(
  "/:workspaceId",
  requireWorkspaceRole("admin"),
  validate({ body: updateWorkspaceBody }),
  asyncHandler(updateWorkspaceController),
);
workspacesRouter.delete(
  "/:workspaceId",
  asyncHandler(deleteWorkspaceController),
);

// Cached member directory (name/avatar) — any member may read.
workspacesRouter.get(
  "/:workspaceId/directory",
  asyncHandler(getDirectoryController),
);

// Any member can leave (the owner can't — enforced in the service).
workspacesRouter.post(
  "/:workspaceId/leave",
  asyncHandler(leaveWorkspaceController),
);

// Channels, members, and invites all inherit the `loadWorkspace` membership
// check above; member/invite mutations add their own `requireWorkspaceRole`.
workspacesRouter.use("/:workspaceId/channels", channelsRouter);
workspacesRouter.use("/:workspaceId/dms", dmsRouter);
workspacesRouter.use("/:workspaceId/members", membersRouter);
workspacesRouter.use("/:workspaceId/invites", invitesRouter);
workspacesRouter.get(
  "/:workspaceId/directory",
  asyncHandler(getDirectoryController),
);
