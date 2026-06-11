import type { Request, Response } from "express";
import * as channels from "./channels.service.js";
import * as messages from "./messages.service.js";
import type {
  CreateChannelBody,
  EditMessageBody,
  ListMessagesQuery,
  MarkReadBody,
  SendMessageBody,
} from "./channels.dto.js";

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
  res.status(201).json(await channels.createChannel(req.workspace.id, req.user.id, body));
}

export async function getChannelController(req: Request, res: Response): Promise<void> {
  res.json(await channels.getChannel(req.workspace.id, req.user.id, req.params.channelId!));
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
    body.body,
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
