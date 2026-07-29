import type { Request, Response } from "express";
import * as preferencesService from "./preferences.service.js";
import type { UpdatePreferencesBody } from "./preferences.dto.js";

/**
 * HTTP handlers for per-user UI preferences. Mounted at `/api/preferences`
 * behind `authenticate` ONLY — preferences are user-global and span every
 * workspace, so this must NOT sit behind `loadWorkspace`.
 */

export async function getPreferencesController(
  req: Request,
  res: Response,
): Promise<void> {
  res.json({ preferences: await preferencesService.getPreferences(req.user.id) });
}

export async function updatePreferencesController(
  req: Request,
  res: Response,
): Promise<void> {
  const patch = req.body as UpdatePreferencesBody;
  const preferences = await preferencesService.updatePreferences(
    req.user.id,
    patch,
  );
  res.json({ preferences });
}
