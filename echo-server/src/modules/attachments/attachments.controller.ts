import type { Request, Response } from "express";
import { clientPolicy } from "./attachment-policy.js";
import { presignAttachment } from "./attachments.service.js";
import type { PresignAttachmentBody } from "./attachments.dto.js";

/**
 * HTTP handlers for the file manager.
 *
 * `presignAttachmentController` is mounted on the channel router (so it inherits
 * `authenticate` + `loadWorkspace` and has `:workspaceId`/`:channelId`); channel
 * membership is enforced inside the service. `policyController` is mounted at the
 * top level (`/api/attachments/policy`) behind `authenticate` only.
 */

export async function presignAttachmentController(req: Request, res: Response): Promise<void> {
  const body = req.body as PresignAttachmentBody;
  const result = await presignAttachment(
    req.workspace.id,
    req.params.channelId!,
    req.user.id,
    body,
  );
  res.json(result);
}

export function policyController(_req: Request, res: Response): void {
  res.json(clientPolicy());
}
