import { z } from "zod";

/** Request shapes for the notification inbox. */

export const listNotificationsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  /** ISO timestamp — return notifications older than this (keyset paging). */
  before: z.string().datetime().optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuery>;

/**
 * Mark-read scope: explicit ids, a whole channel (when a DM is opened), or all.
 * At least one selector must be present.
 */
export const markReadBody = z
  .object({
    ids: z.array(z.string().uuid()).optional(),
    channelId: z.string().uuid().optional(),
    all: z.boolean().optional(),
  })
  .refine((b) => b.all || b.channelId || (b.ids && b.ids.length > 0), {
    message: "Provide ids, channelId, or all",
  });
export type MarkReadBody = z.infer<typeof markReadBody>;

export const settingsParams = z.object({ workspaceId: z.string().uuid() });

export const settingsBody = z.object({ enabled: z.boolean() });
export type SettingsBody = z.infer<typeof settingsBody>;
