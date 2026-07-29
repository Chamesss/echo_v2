import { Router } from "express";
import { asyncHandler } from "../../shared/middleware/async-handler.js";
import { validate } from "../../shared/middleware/validate.js";
import { updatePreferencesBody } from "./preferences.dto.js";
import {
  getPreferencesController,
  updatePreferencesController,
} from "./preferences.controller.js";

/**
 * Per-user UI preferences, mounted at `/api/preferences` behind `authenticate`
 * ONLY (user-scoped, cross-workspace — NOT under the workspace membership wall).
 *
 *   GET  /   the caller's preferences, defaults filled in
 *   PUT  /   partial patch; returns the full resulting payload
 *
 * PUT rather than PATCH because the response is the complete new state, but the
 * body is a partial by design — see `preferences.dto.ts`.
 */
export const preferencesRouter = Router();

preferencesRouter.get("/", asyncHandler(getPreferencesController));
preferencesRouter.put(
  "/",
  validate({ body: updatePreferencesBody }),
  asyncHandler(updatePreferencesController),
);
