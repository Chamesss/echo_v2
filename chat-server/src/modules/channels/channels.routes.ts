import { Router } from "express";
import { validate } from "../../shared/middleware/validate.js";
import { asyncHandler } from "../../shared/middleware/async-handler.js";
import {
  createChannelBody,
  editMessageBody,
  listMessagesQuery,
  markReadBody,
  sendMessageBody,
} from "./channels.dto.js";
import {
  createChannelController,
  deleteMessageController,
  editMessageController,
  getChannelController,
  joinChannelController,
  listChannelsController,
  listMessagesController,
  markReadController,
  sendMessageController,
} from "./channels.controller.js";

/**
 * Channels + messages routes, mounted at
 * `/api/workspaces/:workspaceId/channels` in `workspaces.routes.ts`.
 *
 * `mergeParams: true` so `:workspaceId` from the parent is visible here. The
 * parent already ran `authenticate` + `loadWorkspace`, so workspace membership
 * is guaranteed; channel-level membership is enforced in the services.
 *
 *   GET    /                              list visible channels (+ unread)
 *   POST   /                              create a channel
 *   GET    /:channelId                    channel detail
 *   POST   /:channelId/join               open-join a public channel
 *   GET    /:channelId/messages           history (?before, ?limit) | catch-up (?since)
 *   POST   /:channelId/messages           send (idempotent on clientId)
 *   PATCH  /:channelId/messages/:messageId   edit (author only)
 *   DELETE /:channelId/messages/:messageId   soft-delete (author only)
 *   POST   /:channelId/read               advance read cursor
 */
export const channelsRouter = Router({ mergeParams: true });

channelsRouter.get("/", asyncHandler(listChannelsController));
channelsRouter.post(
  "/",
  validate({ body: createChannelBody }),
  asyncHandler(createChannelController),
);
channelsRouter.get("/:channelId", asyncHandler(getChannelController));
channelsRouter.post("/:channelId/join", asyncHandler(joinChannelController));

channelsRouter.get(
  "/:channelId/messages",
  validate({ query: listMessagesQuery }),
  asyncHandler(listMessagesController),
);
channelsRouter.post(
  "/:channelId/messages",
  validate({ body: sendMessageBody }),
  asyncHandler(sendMessageController),
);
channelsRouter.patch(
  "/:channelId/messages/:messageId",
  validate({ body: editMessageBody }),
  asyncHandler(editMessageController),
);
channelsRouter.delete(
  "/:channelId/messages/:messageId",
  asyncHandler(deleteMessageController),
);
channelsRouter.post(
  "/:channelId/read",
  validate({ body: markReadBody }),
  asyncHandler(markReadController),
);
