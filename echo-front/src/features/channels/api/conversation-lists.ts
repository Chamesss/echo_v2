import type { QueryClient } from "@tanstack/react-query";
import { channelsKey } from "./keys";
import { dmsKey } from "./use-dms";

/**
 * Re-read BOTH conversation lists — the one helper every "the member set or
 * metadata changed" path goes through.
 *
 * A conversation is identified everywhere by `channelId` alone, and that id says
 * nothing about which list it belongs to: named channels come from `channelsKey`,
 * `direct` and `group` conversations from `dmsKey`. So any handler holding only
 * an id has to refresh both, and the ones that refreshed only `channelsKey` were
 * silently wrong for every group.
 *
 * That mattered most for MEMBERSHIP changes, because the DM list is the sole
 * source of `participants` — the avatar stack in the sidebar, the avatars and
 * names at the top of a conversation, and the header's member count. Adding or
 * removing someone refreshed the settings dialog's roster (`channelMembersKey`,
 * a different key entirely) while every avatar surface went on rendering the old
 * member set until a full reload.
 *
 * Cheap enough to call unconditionally: `invalidateQueries` only refetches
 * ACTIVE queries, so the list the user isn't looking at is just marked stale.
 */
export function invalidateConversationLists(qc: QueryClient, workspaceId: string): void {
  void qc.invalidateQueries({ queryKey: channelsKey(workspaceId) });
  void qc.invalidateQueries({ queryKey: dmsKey(workspaceId) });
}
