import { Router } from "express";
import { asyncHandler } from "../../shared/middleware/async-handler.js";
import { policyController } from "./attachments.controller.js";

/**
 * Top-level attachments routes, mounted at `/api/attachments` behind
 * `authenticate`. Only the (workspace-agnostic) policy lives here; the presign
 * endpoint is channel-scoped and mounted on the channel router instead.
 *
 *   GET /policy   the file-manager policy (categories, caps, max-per-message)
 */
export const attachmentsRouter = Router();

attachmentsRouter.get("/policy", asyncHandler(async (req, res) => policyController(req, res)));
