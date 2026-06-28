import { Router } from "express";
import { asyncHandler } from "../../shared/middleware/async-handler.js";
import { validate } from "../../shared/middleware/validate.js";
import { listNotificationsQuery, markReadBody, settingsBody, settingsParams } from "./notifications.dto.js";
import {
  getSettingsController,
  listNotificationsController,
  markReadController,
  markSeenController,
  setSettingsController,
  summaryController,
} from "./notifications.controller.js";

/**
 * Notification inbox, mounted at `/api/notifications` behind `authenticate` ONLY
 * (user-scoped, cross-workspace — NOT under the workspace membership wall).
 *
 *   GET   /            recent inbox (paged)
 *   GET   /summary     per-workspace unread + global unseen (badge seed)
 *   POST  /seen        mark all unseen → seen (clears the global dot)
 *   POST  /read        mark read (by ids / channelId / all)
 */
export const notificationsRouter = Router();

notificationsRouter.get(
  "/",
  validate({ query: listNotificationsQuery }),
  asyncHandler(listNotificationsController),
);
notificationsRouter.get("/summary", asyncHandler(summaryController));
notificationsRouter.post("/seen", asyncHandler(markSeenController));
notificationsRouter.post("/read", validate({ body: markReadBody }), asyncHandler(markReadController));

// Per-workspace notification preference (enable/disable bell + toast).
notificationsRouter.get(
  "/settings/:workspaceId",
  validate({ params: settingsParams }),
  asyncHandler(getSettingsController),
);
notificationsRouter.put(
  "/settings/:workspaceId",
  validate({ params: settingsParams, body: settingsBody }),
  asyncHandler(setSettingsController),
);
