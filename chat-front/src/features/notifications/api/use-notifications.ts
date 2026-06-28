import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationWire } from "@server/infrastructure/realtime/protocol";
import type { NotificationSummary } from "@server/modules/notifications/notifications.service";
import { apiFetch } from "@/lib/api";
import { notificationsKey, notificationsSummaryKey } from "./keys";

export type { NotificationWire, NotificationSummary };

const EMPTY_SUMMARY: NotificationSummary = { unseen: 0, workspaces: [] };

/**
 * Per-workspace unread + global unseen counts — the cross-workspace badge SEED.
 *
 * This is deliberately NOT auto-refetched (no focus poll): it's kept live by the
 * user socket (the provider mutates this cache on events) and healed on reconnect
 * + on explicit reads (invalidation). A background refetch was the source of the
 * "old state +1" resurrection — a server snapshot taken before a just-committed
 * `markRead` would overwrite an already-cleared count. For any workspace whose
 * lists are loaded, `useWorkspaceUnread` derives the count from those (the single
 * source of truth) and ignores this entirely; this only seeds unopened
 * workspaces. `placeholderData` (not `initialData`) so it still fetches once on
 * mount while showing an empty seed immediately.
 */
export function useNotificationsSummary() {
  return useQuery({
    queryKey: notificationsSummaryKey,
    queryFn: () => apiFetch<NotificationSummary>("/api/notifications/summary"),
    placeholderData: EMPTY_SUMMARY,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/**
 * Recent inbox entries (newest first). Loaded when the bell opens. The cache
 * stores the BARE array so the live `notification.created` prepend (setQueryData
 * of an array) matches the shape it reads — otherwise the inbox only updates on
 * refetch.
 */
export function useNotificationsList(enabled: boolean) {
  return useQuery({
    queryKey: notificationsKey,
    queryFn: async () => {
      const { notifications } = await apiFetch<{ notifications: NotificationWire[] }>(
        "/api/notifications?limit=30",
      );
      return notifications;
    },
    enabled,
  });
}

/** Mark every unseen notification seen — clears the global bell dot. */
export function useMarkSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ seen: number }>("/api/notifications/seen", { method: "POST" }),
    onSuccess: () => {
      qc.setQueryData<NotificationSummary>(notificationsSummaryKey, (s) =>
        s ? { ...s, unseen: 0 } : s,
      );
    },
  });
}

/** Mark notifications read (by ids, by channel, or all). */
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scope: { ids?: string[]; channelId?: string; all?: boolean }) =>
      apiFetch<{ read: number }>("/api/notifications/read", { method: "POST", body: scope }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationsKey });
      qc.invalidateQueries({ queryKey: notificationsSummaryKey });
    },
  });
}

const settingsKey = (workspaceId: string) =>
  ["notifications", "settings", workspaceId] as const;

/** The caller's notification preference for a workspace (default: enabled). */
export function useNotificationSettings(workspaceId: string) {
  return useQuery({
    queryKey: settingsKey(workspaceId),
    queryFn: () =>
      apiFetch<{ enabled: boolean }>(`/api/notifications/settings/${workspaceId}`),
    select: (d) => d.enabled,
  });
}

/** Enable/disable the bell + toast for a workspace (unread counts are unaffected). */
export function useSetNotificationSettings(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch<{ enabled: boolean }>(`/api/notifications/settings/${workspaceId}`, {
        method: "PUT",
        body: { enabled },
      }),
    onSuccess: (data) => qc.setQueryData(settingsKey(workspaceId), data),
  });
}
