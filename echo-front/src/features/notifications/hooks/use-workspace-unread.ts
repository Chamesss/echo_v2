import { useQuery } from "@tanstack/react-query";
import { channelsKey } from "@/features/channels/api/keys";
import { dmsKey, fetchDms, type DirectMessageDTO } from "@/features/channels/api/use-dms";
import { useActiveConversation } from "@/features/channels/hooks/use-active-channel";
import { fetchChannels, type ChannelDTO } from "@/features/channels/api/use-channels";
import { useNotificationsSummary } from "../api/use-notifications";
import { sumUnread } from "../store";

/**
 * A workspace's awareness badge counts for the rail / switcher.
 *
 * `unread` is derived from a SINGLE source of truth to keep the rail badge and
 * the sidebar perfectly in sync: when a workspace's channel + DM lists are
 * loaded (i.e. you've opened it this session), we sum THOSE — the exact same
 * numbers the sidebar shows, kept precise by the bump/clear path — and exclude
 * the conversation you're actively viewing (zero unread to you). The server
 * summary's per-workspace `unread` is only a fallback to SEED workspaces you
 * haven't opened yet.
 *
 * Two rules kill the on-refresh flicker (a count that flashes then clears) and
 * the dual-source drift ("old state +1"):
 *   1. The active channel is excluded everywhere, so the channel you're reading
 *      never contributes a count that the auto-mark-read then removes.
 *   2. For the workspace you're currently IN, we never fall back to the summary
 *      (which still counts that channel until its read commits) — we wait for the
 *      authoritative lists, which load immediately since you're already here.
 *
 * `notifications` (unread inbox entries) still comes from the summary — it has no
 * list-backed equivalent and isn't subject to the read-cursor race.
 */
export function useWorkspaceUnread(
  workspaceId: string,
): { unread: number; notifications: number } {
  const { data: summary } = useNotificationsSummary();
  const active = useActiveConversation();

  // Read — but never fetch — the workspace's lists, reactively. A disabled query
  // still observes the cache, so the badge re-renders when the bump/clear path
  // mutates the lists, without the rail eagerly loading every workspace's data.
  //
  // `queryFn` is passed even though `enabled: false` means it never runs here.
  // Two reasons:
  //   1. `useBaseQuery` console.errors "No queryFn was passed" on EVERY render
  //      of a queryFn-less useQuery, `enabled` notwithstanding. The rail mounts
  //      two of these per workspace, which buried the dev console.
  //   2. React Query keeps one options object per query key, written by
  //      whichever observer rendered last — often one of these. A refetch
  //      driven by those options only works because `Query.fetch` falls back to
  //      borrowing a queryFn from another observer; that fallback is an
  //      implementation detail we'd rather not have the DM list depend on.
  const { data: channels } = useQuery<ChannelDTO[]>({
    queryKey: channelsKey(workspaceId),
    queryFn: () => fetchChannels(workspaceId),
    enabled: false,
  });
  const { data: dms } = useQuery<DirectMessageDTO[]>({
    queryKey: dmsKey(workspaceId),
    queryFn: () => fetchDms(workspaceId),
    enabled: false,
  });

  const ws = summary?.workspaces.find((w) => w.workspaceId === workspaceId);
  const listsLoaded = channels !== undefined || dms !== undefined;
  const isActiveWorkspace = workspaceId === active.workspaceId;

  let unread: number;
  if (listsLoaded) {
    unread = sumUnread([channels, dms], active.channelId ?? undefined);
  } else if (isActiveWorkspace) {
    // We're in this workspace; its lists are loading. Don't flash the summary —
    // it still counts the channel we're reading. Show 0 until the lists arrive.
    unread = 0;
  } else {
    unread = ws?.unread ?? 0;
  }

  return { unread, notifications: ws?.notifications ?? 0 };
}
