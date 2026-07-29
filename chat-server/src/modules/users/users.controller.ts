import type { Request, Response } from "express";
import * as service from "./users.service.js";
import type { PresignAvatarBody, SetPasswordBody } from "./users.dto.js";

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

/**
 * Handles `POST /api/users/me/password`.
 *
 * Mounted behind `authenticate` + `validate(setPasswordBody)` + `asyncHandler`
 * in `users.routes.ts`. Sets a first password for a social-only account; see
 * `users.service.ts#setInitialPassword` for why this doesn't live in Better
 * Auth's own route table.
 */
export async function setPasswordController(
  req: Request,
  res: Response,
): Promise<void> {
  const body = req.body as SetPasswordBody;
  await service.setInitialPassword(req.user.id, req.headers, body);
  res.status(204).end();
}
