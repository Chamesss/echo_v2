import { Router } from "express";
import { validate } from "../../shared/middleware/validate.js";
import { asyncHandler } from "../../shared/middleware/async-handler.js";
import { presignAvatarBody, setPasswordBody } from "./users.dto.js";
import { presignAvatarController, setPasswordController } from "./users.controller.js";

/**
 * User routes — currently just avatar upload presigning.
 *
 * Mounted at `/api/users` in `app.ts` behind the `authenticate` middleware.
 * Profile field updates (name, image URL, email change, password CHANGE) go
 * through Better Auth's own endpoints at /api/auth/* — we don't reinvent
 * them. This router is only for things Better Auth doesn't already
 * expose: avatar uploads, and setting a first password (Better Auth's
 * `setPassword` has no HTTP route — see `users.service.ts`).
 */
export const usersRouter = Router();

usersRouter.post(
  "/me/avatar",
  validate({ body: presignAvatarBody }),
  asyncHandler(presignAvatarController),
);

usersRouter.post(
  "/me/password",
  validate({ body: setPasswordBody }),
  asyncHandler(setPasswordController),
);
