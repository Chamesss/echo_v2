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

/** Prepend a notification to the inbox list, deduped by id. */
export function prependNotification(
  list: NotificationWire[] | undefined,
  n: NotificationWire,
): NotificationWire[] {
  const rest = (list ?? []).filter((x) => x.id !== n.id);
  return [n, ...rest];
}

/** Bump a single channel/DM's unread by 1 in a channels-or-dms list cache. */
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
