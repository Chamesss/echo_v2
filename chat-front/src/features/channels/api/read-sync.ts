import type { QueryClient } from "@tanstack/react-query";
import type { NotificationSummary } from "@server/modules/notifications/notifications.service";
import { bumpWorkspaceUnread } from "@/features/notifications/store";
import { notificationsSummaryKey } from "@/features/notifications/api/keys";
import { channelsKey } from "./keys";
import { dmsKey, type DirectMessageDTO } from "./use-dms";
import type { ChannelDTO } from "./use-channels";

/**
 * Clear a conversation's unread across ALL the caches it touches, keeping them in
 * sync: the per-channel badge (channels OR DMs list) AND the workspace roll-up in
 * the notifications summary (the rail / switcher badge).
 *
 * Idempotent by design: it reads the conversation's CURRENT cached unread and, if
 * it's already 0, does nothing. So the two "I read this" signals — `useMarkRead`'s
 * optimistic success and the `channel.read` socket echo — can both call it without
 * double-decrementing the roll-up (whichever runs first transitions it to 0; the
 * other is a no-op). The roll-up is decremented by exactly the amount cleared, so
 * `summary.unread` stays equal to the sum of the per-channel unreads.
 */
export function clearConversationUnread(
  qc: QueryClient,
  workspaceId: string,
  channelId: string,
): void {
  const channels = qc.getQueryData<ChannelDTO[]>(channelsKey(workspaceId));
  const dms = qc.getQueryData<DirectMessageDTO[]>(dmsKey(workspaceId));
  const current =
    channels?.find((c) => c.id === channelId)?.unread ??
    dms?.find((d) => d.id === channelId)?.unread ??
    0;
  if (current <= 0) return; // already read — no-op (keeps this idempotent)

  const clear = <T extends { id: string; unread: number }>(l: T[] | undefined) =>
    l ? l.map((c) => (c.id === channelId ? { ...c, unread: 0 } : c)) : l;
  qc.setQueryData<ChannelDTO[]>(channelsKey(workspaceId), clear);
  qc.setQueryData<DirectMessageDTO[]>(dmsKey(workspaceId), clear);

  // Decrement the workspace roll-up by what we just cleared.
  qc.setQueryData<NotificationSummary>(notificationsSummaryKey, (s) =>
    s ? bumpWorkspaceUnread(s, workspaceId, -current) : s,
  );
}
