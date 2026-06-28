import type { Request, Response } from "express";
import * as dm from "./dm.service.js";
import type { OpenDmBody } from "./channels.dto.js";

/**
 * HTTP handlers for `/api/workspaces/:workspaceId/dms`. The router chain ran
 * `authenticate` + `loadWorkspace`, so the caller is a workspace member.
 * Per-DM access (reading/posting) is enforced by `channel_members` in the
 * shared channel/message services.
 */

export async function listDmsController(req: Request, res: Response): Promise<void> {
  res.json({ dms: await dm.listDirectMessages(req.workspace.id, req.user.id) });
}

export async function openDmController(req: Request, res: Response): Promise<void> {
  const { userIds } = req.body as OpenDmBody;
  const channel = await dm.openOrCreateDm(req.workspace.id, req.user.id, userIds);
  res.status(201).json(channel);
}
