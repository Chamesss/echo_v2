import { Router } from "express";
import { asyncHandler } from "../../shared/middleware/async-handler.js";
import { fileRedirectController } from "./files.controller.js";

/**
 * Public signed-redirect for owned private-bucket objects (avatars + chat
 * attachments). Mounted at `/api/files`, OUTSIDE the auth wall, because it's
 * loaded by `<img>`/`<video>` tags that can't carry the session cookie
 * cross-origin — see `fileRedirectController` for the (key-as-bearer) model.
 *
 *   GET /?key=<owned s3 key>   302 → a freshly-signed, short-lived S3 GET
 */
export const filesRouter = Router();
filesRouter.get("/", asyncHandler(fileRedirectController));
