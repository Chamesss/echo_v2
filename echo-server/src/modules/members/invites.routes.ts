import { Router } from "express";
import { asyncHandler } from "../../shared/middleware/async-handler.js";
import { rateLimit, CREATE_LIMIT } from "../../shared/middleware/rate-limit.js";
import { validate } from "../../shared/middleware/validate.js";
import { requireWorkspaceRole } from "../../shared/middleware/require-workspace-role.js";
import { createInviteBody } from "./members.dto.js";
import { createInviteController, listInvitesController } from "./members.controller.js";

/**
 * Workspace-scoped invites, mounted at `/api/workspaces/:workspaceId/invites`.
 * Admin-only (creating/viewing pending invites is a governance action).
 *
 *   GET   /     admin: list pending invites
 *   POST  /     admin: invite an email (sends a tokenized link)
 */
export const invitesRouter = Router({ mergeParams: true });

invitesRouter.get("/", requireWorkspaceRole("admin"), asyncHandler(listInvitesController));
invitesRouter.post(
  "/",
  requireWorkspaceRole("admin"),
  rateLimit(CREATE_LIMIT),
  validate({ body: createInviteBody }),
  asyncHandler(createInviteController),
);
