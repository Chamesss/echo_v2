import type { Request, Response } from "express";
import * as service from "./users.service.js";
import type { PresignAvatarBody } from "./users.dto.js";

/**
 * Handles `POST /api/users/me/avatar`.
 *
 * Mounted behind `authenticate` + `validate(presignAvatarBody)` +
 * `asyncHandler` in `users.routes.ts`. Returns a presigned S3 PUT URL the
 * browser uses to upload the file directly, plus the public URL the user
 * row should be updated with afterwards.
 */
export async function presignAvatarController(
  req: Request,
  res: Response,
): Promise<void> {
  const body = req.body as PresignAvatarBody;
  const result = await service.createAvatarUpload(req.user.id, body);
  res.json(result);
}
