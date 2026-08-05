import type { Request, Response } from "express";
import * as notificationsService from "./notifications.service.js";
import type { ListNotificationsQuery, MarkReadBody, SettingsBody } from "./notifications.dto.js";

/**
 * HTTP handlers for the notification inbox. Mounted at `/api/notifications`
 * behind `authenticate` ONLY — the inbox is user-scoped and spans every
 * workspace the caller belongs to, so it must NOT sit behind `loadWorkspace`.
 */

export async function listNotificationsController(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ListNotificationsQuery;
  const notifications = await notificationsService.listNotifications(req.user.id, {
    limit: q.limit,
    before: q.before,
    beforeId: q.beforeId,
  });
  res.json({ notifications });
}

export async function summaryController(req: Request, res: Response): Promise<void> {
  res.json(await notificationsService.getSummary(req.user.id));
}

export async function markSeenController(req: Request, res: Response): Promise<void> {
  const seen = await notificationsService.markAllSeen(req.user.id);
  res.json({ seen });
}

export async function markReadController(req: Request, res: Response): Promise<void> {
  const body = req.body as MarkReadBody;
  const read = await notificationsService.markRead(req.user.id, body);
  res.json({ read });
}

export async function getSettingsController(req: Request, res: Response): Promise<void> {
  const enabled = await notificationsService.getNotificationEnabled(
    req.user.id,
    req.params.workspaceId!,
  );
  res.json({ enabled });
}

export async function setSettingsController(req: Request, res: Response): Promise<void> {
  const body = req.body as SettingsBody;
  await notificationsService.setNotificationEnabled(
    req.user.id,
    req.params.workspaceId!,
    body.enabled,
  );
  res.json({ enabled: body.enabled });
}
