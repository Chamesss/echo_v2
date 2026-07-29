import { Router } from "express";
import { asyncHandler } from "../../shared/middleware/async-handler.js";
import { authenticate } from "../../shared/middleware/authenticate.js";
import { acceptInviteController, getInviteController } from "./members.controller.js";

/**
 * Invite acceptance, mounted at `/api/invites`. Deliberately NOT under the
 * workspace router: the invitee isn't a member yet, so `loadWorkspace` would 403
 * them; membership is what they're acquiring.
 *
 * Auth is split per-route so an UNREGISTERED invitee can onboard:
 *   GET  /:token          PUBLIC — a logged-out person must be able to view the
 *                         invite (workspace/inviter/target email) to decide to
 *                         sign up. The token is the secret; it exposes nothing an
 *                         email recipient shouldn't already see.
 *   POST /:token/accept   AUTHENTICATED — creates the membership and matches the
 *                         invite email to the signed-in account.
 */
export const acceptInvitesRouter = Router();

acceptInvitesRouter.get("/:token", asyncHandler(getInviteController));
acceptInvitesRouter.post("/:token/accept", authenticate, asyncHandler(acceptInviteController));
