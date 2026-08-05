import { z } from "zod";

/** Request shapes for the notification inbox. */

export const listNotificationsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  /** ISO timestamp — return notifications older than this (keyset paging). */
  before: z.string().datetime().optional(),
  /**
   * The id of the row `before` came from, to break ties on identical timestamps.
   *
   * `created_at` alone isn't a unique sort key: two messages reaching the same
   * person in the same instant order arbitrarily, and an arbitrary order means a
   * page boundary can silently skip a row or repeat one. Optional so an older
   * client still pages (just without the tie-break).
   */
  beforeId: z.string().uuid().optional(),
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
