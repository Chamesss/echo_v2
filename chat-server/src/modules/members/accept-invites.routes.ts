import { Router } from "express";
import { asyncHandler } from "../../shared/middleware/async-handler.js";
import { acceptInviteController, getInviteController } from "./members.controller.js";

/**
 * Invite acceptance, mounted at `/api/invites` behind `authenticate` ONLY.
 *
 * Deliberately NOT under the workspace router: the invitee isn't a member yet,
 * so `loadWorkspace` would 403 them. They must be signed in (so we can match
 * the invite email to their account), but membership is what they're acquiring.
 *
 *   GET   /:token           view invite (workspace, inviter, status)
 *   POST  /:token/accept    accept → creates the membership
 */
export const acceptInvitesRouter = Router();

acceptInvitesRouter.get("/:token", asyncHandler(getInviteController));
acceptInvitesRouter.post("/:token/accept", asyncHandler(acceptInviteController));
