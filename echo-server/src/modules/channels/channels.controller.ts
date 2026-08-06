import type { Request, Response } from "express";
import { logWorkspaceEvent, WorkspaceEventName } from "../../infrastructure/audit/audit-log.js";
import * as channels from "./channels.service.js";
import * as members from "./channels.members.js";
import * as messages from "./messages.service.js";
import type {
  AddChannelMemberBody,
  CreateChannelBody,
  EditMessageBody,
  ListMessagesQuery,
  MarkReadBody,
  SendMessageBody,
  UpdateChannelBody,
} from "./channels.dto.js";

/** Actor passed to channel management ops (admin-or-creator authz). */
function channelActor(req: Request) {
  return { userId: req.user.id, isWorkspaceAdmin: req.workspace.role === "admin" };
}

function auditActor(req: Request) {
  return { ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
}

/**
 * HTTP handlers for `/api/workspaces/:workspaceId/channels`.
 *
 * The router chain has already run `authenticate` (→ `req.user`) and
 * `loadWorkspace` (→ `req.workspace`, membership-checked), so every handler
 * trusts `req.workspace.id` + `req.user.id`. Channel-level membership is
 * enforced inside the services.
 */

export async function listChannelsController(req: Request, res: Response): Promise<void> {
  res.json(await channels.listChannels(req.workspace.id, req.user.id));
}

export async function createChannelController(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateChannelBody;
  const channel = await channels.createChannel(req.workspace.id, req.user.id, body);
  await logWorkspaceEvent({
    userId: req.user.id,
    workspaceId: req.workspace.id,
    event: WorkspaceEventName.ChannelCreated,
    metadata: { channelId: channel.id, type: channel.type, name: channel.name },
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  });
  res.status(201).json(channel);
}

export async function updateChannelController(req: Request, res: Response): Promise<void> {
  const body = req.body as UpdateChannelBody;
  const channel = await channels.updateChannel(
    req.workspace.id,
    req.params.channelId!,
    channelActor(req),
    body,
  );
  await logWorkspaceEvent({
    userId: req.user.id,
    workspaceId: req.workspace.id,
    event:
      body.archived !== undefined
        ? WorkspaceEventName.ChannelArchived
        : WorkspaceEventName.ChannelRenamed,
    metadata: { channelId: channel.id, ...body },
    ...auditActor(req),
  });
  res.json(channel);
}

export async function deleteChannelController(req: Request, res: Response): Promise<void> {
  await channels.deleteChannel(req.workspace.id, req.params.channelId!, channelActor(req));
  await logWorkspaceEvent({
    userId: req.user.id,
    workspaceId: req.workspace.id,
    event: WorkspaceEventName.ChannelDeleted,
    metadata: { channelId: req.params.channelId },
    ...auditActor(req),
  });
  res.status(204).end();
}

export async function leaveChannelController(req: Request, res: Response): Promise<void> {
  await members.leaveChannel(req.workspace.id, req.user.id, req.params.channelId!);
  res.status(204).end();
}

export async function listChannelMembersController(req: Request, res: Response): Promise<void> {
  const list = await members.listChannelMembers(
    req.workspace.id,
    req.user.id,
    req.params.channelId!,
  );
  res.json({ members: list });
}

export async function addChannelMemberController(req: Request, res: Response): Promise<void> {
  const { userId } = req.body as AddChannelMemberBody;
  await members.addChannelMember(req.workspace.id, req.params.channelId!, req.user.id, userId);
  res.status(204).end();
}

export async function removeChannelMemberController(req: Request, res: Response): Promise<void> {
  await members.removeChannelMember(
    req.workspace.id,
    req.params.channelId!,
    channelActor(req),
    req.params.userId!,
  );
  res.status(204).end();
}

export async function getChannelController(req: Request, res: Response): Promise<void> {
  res.json(await channels.getChannel(req.workspace.id, req.user.id, req.params.channelId!));
}

export async function listChannelReadsController(req: Request, res: Response): Promise<void> {
  const reads = await members.getChannelReads(
    req.workspace.id,
    req.user.id,
    req.params.channelId!,
  );
  res.json({ reads });
}

export async function joinChannelController(req: Request, res: Response): Promise<void> {
  res.json(await channels.joinChannel(req.workspace.id, req.user.id, req.params.channelId!));
}

export async function listMessagesController(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListMessagesQuery;
  const list = await messages.listMessages(
    req.workspace.id,
    req.params.channelId!,
    req.user.id,
    query,
  );
  res.json({ messages: list });
}

export async function sendMessageController(req: Request, res: Response): Promise<void> {
  const body = req.body as SendMessageBody;
  const message = await messages.sendMessage(
    req.workspace.id,
    req.params.channelId!,
    req.user.id,
    body,
  );
  res.status(201).json(message);
}

export async function editMessageController(req: Request, res: Response): Promise<void> {
  const body = req.body as EditMessageBody;
  const message = await messages.editMessage(
    req.workspace.id,
    req.params.channelId!,
    req.params.messageId!,
    req.user.id,
    { body: body.body, keepAttachmentIds: body.keepAttachmentIds, attachments: body.attachments },
  );
  res.json(message);
}

export async function deleteMessageController(req: Request, res: Response): Promise<void> {
  const message = await messages.deleteMessage(
    req.workspace.id,
    req.params.channelId!,
    req.params.messageId!,
    req.user.id,
  );
  res.json(message);
}

export async function markReadController(req: Request, res: Response): Promise<void> {
  const body = req.body as MarkReadBody;
  const result = await messages.markRead(
    req.workspace.id,
    req.params.channelId!,
    req.user.id,
    body.seq,
  );
  res.json(result);
}
