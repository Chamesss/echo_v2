import { Router } from "express";
import { validate } from "../../shared/middleware/validate.js";
import { asyncHandler } from "../../shared/middleware/async-handler.js";
import { presignAttachmentBody } from "../attachments/attachments.dto.js";
import { presignAttachmentController } from "../attachments/attachments.controller.js";
import {
  addChannelMemberBody,
  createChannelBody,
  editMessageBody,
  listMessagesQuery,
  markReadBody,
  sendMessageBody,
  updateChannelBody,
} from "./channels.dto.js";
import {
  addChannelMemberController,
  createChannelController,
  deleteChannelController,
  deleteMessageController,
  editMessageController,
  getChannelController,
  joinChannelController,
  leaveChannelController,
  listChannelMembersController,
  listChannelReadsController,
  listChannelsController,
  listMessagesController,
  markReadController,
  removeChannelMemberController,
  sendMessageController,
  updateChannelController,
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
channelsRouter.patch(
  "/:channelId",
  validate({ body: updateChannelBody }),
  asyncHandler(updateChannelController),
);
channelsRouter.delete("/:channelId", asyncHandler(deleteChannelController));
channelsRouter.post("/:channelId/join", asyncHandler(joinChannelController));
channelsRouter.post("/:channelId/leave", asyncHandler(leaveChannelController));

// Channel membership (private-channel management). Authz is enforced in the
// service: any member may add; admin-or-creator may remove.
channelsRouter.get("/:channelId/members", asyncHandler(listChannelMembersController));
channelsRouter.post(
  "/:channelId/members",
  validate({ body: addChannelMemberBody }),
  asyncHandler(addChannelMemberController),
);
channelsRouter.delete(
  "/:channelId/members/:userId",
  asyncHandler(removeChannelMemberController),
);

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

// Read receipts: every member's read cursor for the channel ("seen by who").
channelsRouter.get("/:channelId/reads", asyncHandler(listChannelReadsController));

// Attachments: mint a presigned S3 PUT for a file the caller wants to attach.
// Channel membership is enforced in the service. The uploaded keys are then
// passed back when posting the message (POST /:channelId/messages).
channelsRouter.post(
  "/:channelId/attachments/presign",
  validate({ body: presignAttachmentBody }),
  asyncHandler(presignAttachmentController),
);
