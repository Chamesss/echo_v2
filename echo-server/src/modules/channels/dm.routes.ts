import { Router } from "express";
import { asyncHandler } from "../../shared/middleware/async-handler.js";
import { rateLimit, CREATE_LIMIT } from "../../shared/middleware/rate-limit.js";
import { validate } from "../../shared/middleware/validate.js";
import { openDmBody } from "./channels.dto.js";
import { listDmsController, openDmController } from "./dm.controller.js";

/**
 * Direct & group messages, mounted at `/api/workspaces/:workspaceId/dms`.
 * Parent ran `authenticate` + `loadWorkspace`. Once a DM exists, its messages
 * are read/sent via the normal `/channels/:channelId/messages` routes.
 *
 *   GET   /     list the caller's DMs
 *   POST  /     open-or-create a DM with { userIds }
 */
export const dmsRouter = Router({ mergeParams: true });

dmsRouter.get("/", asyncHandler(listDmsController));
dmsRouter.post(
  "/",
  rateLimit(CREATE_LIMIT),
  validate({ body: openDmBody }),
  asyncHandler(openDmController),
);
