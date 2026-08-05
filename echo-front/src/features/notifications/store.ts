import type { InfiniteData } from "@tanstack/react-query";
import type { NotificationWire } from "@server/infrastructure/realtime/protocol";
import type { NotificationSummary } from "@server/modules/notifications/notifications.service";

/**
 * Pure reducers for the awareness caches. Kept side-effect-free (no React Query,
 * no sockets) so the live-update logic is unit-testable; the provider applies
 * them via `setQueryData`.
 */

/** Bump (or seed) a workspace's unread total in the summary by `delta`. */
export function bumpWorkspaceUnread(
  summary: NotificationSummary,
  workspaceId: string,
  delta: number,
): NotificationSummary {
  const workspaces = [...summary.workspaces];
  const i = workspaces.findIndex((w) => w.workspaceId === workspaceId);
  if (i >= 0) {
    workspaces[i] = { ...workspaces[i]!, unread: Math.max(0, workspaces[i]!.unread + delta) };
  } else if (delta > 0) {
    workspaces.push({ workspaceId, unread: delta, notifications: 0 });
  }
  return { ...summary, workspaces };
}

/** A new notification arrived: +1 global unseen and +1 to that workspace's count. */
export function addNotificationToSummary(
  summary: NotificationSummary,
  workspaceId: string,
): NotificationSummary {
  const workspaces = [...summary.workspaces];
  const i = workspaces.findIndex((w) => w.workspaceId === workspaceId);
  if (i >= 0) {
    workspaces[i] = { ...workspaces[i]!, notifications: workspaces[i]!.notifications + 1 };
  } else {
    workspaces.push({ workspaceId, unread: 0, notifications: 1 });
  }
  return { ...summary, unseen: summary.unseen + 1, workspaces };
}

/**
 * Prepend a live notification to the paged inbox, deduped by id.
 *
 * The inbox is an infinite query, so its cache is `{ pages, pageParams }` rather
 * than a flat array — the new entry belongs at the head of `pages[0]`, which is
 * the newest page. Dedupe sweeps EVERY page, not just the first: an entry that
 * arrived live can also come back in a refetched page, and two copies of one
 * notification would both render and both count.
 *
 * Returns the cache untouched when it isn't loaded. Seeding a page here would
 * invent a page the server never sent, and `getNextPageParam` would then read a
 * one-item page as "there is nothing older" — permanently hiding the real
 * history behind a tray that thinks it's complete.
 */
export function prependNotification(
  data: InfiniteData<NotificationWire[]> | undefined,
  n: NotificationWire,
): InfiniteData<NotificationWire[]> | undefined {
  if (!data) return data;
  const pages = data.pages.map((page) => page.filter((x) => x.id !== n.id));
  return { ...data, pages: [[n, ...(pages[0] ?? [])], ...pages.slice(1)] };
}

/**
 * Is this conversation present in a (possibly unloaded) channels-or-dms list?
 *
 * `undefined` means "the list isn't cached", which is NOT the same as "absent" —
 * the provider uses that distinction to decide whether an event naming an
 * unknown conversation is a cache gap worth healing or just a workspace the user
 * has never opened (which will fetch on mount anyway).
 */
export function hasConversation(
  list: Array<{ id: string }> | undefined,
  channelId: string,
): boolean {
  return (list ?? []).some((c) => c.id === channelId);
}

/**
 * Bump a single channel/DM's unread by 1 in a channels-or-dms list cache.
 *
 * Returns the list unchanged when the id isn't there. That silence is why the
 * provider pairs this with `hasConversation`: a bump for a conversation we've
 * never seen means our list is stale, not that the event was spurious.
 */
export function bumpChannelUnread<T extends { id: string; unread: number }>(
  list: T[] | undefined,
  channelId: string,
): T[] | undefined {
  if (!list) return list;
  let changed = false;
  const next = list.map((c) => {
    if (c.id === channelId) {
      changed = true;
      return { ...c, unread: c.unread + 1 };
    }
    return c;
  });
  return changed ? next : list;
}

/**
 * Sum unread across a workspace's loaded channels + DMs (the accurate current-ws
 * total). `excludeId` drops one conversation from the total — used to exclude the
 * channel the user is actively viewing (it has zero unread to them).
 */
export function sumUnread(
  lists: Array<Array<{ id?: string; unread: number }> | undefined>,
  excludeId?: string,
): number {
  return lists.reduce(
    (total, list) =>
      total +
      (list ?? []).reduce(
        (s, c) => s + (excludeId !== undefined && c.id === excludeId ? 0 : Math.max(0, c.unread)),
        0,
      ),
    0,
  );
}
