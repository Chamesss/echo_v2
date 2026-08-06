import { useQuery } from "@tanstack/react-query";
import type { ChannelReadDTO } from "@server/modules/channels/channels.members";
import { apiFetch } from "@/lib/api";
import { readsKey } from "./keys";

export type { ChannelReadDTO };

/**
 * Every member's read cursor for a channel — the basis for "seen by" receipts.
 * Seeded from the server on open; kept live by `useChannelStream`, which upserts
 * cursors as `channel.read` events arrive. `staleTime: Infinity` because the
 * realtime stream owns freshness (a background refetch would clobber live state).
 */
export function useChannelReads(workspaceId: string, channelId: string) {
  return useQuery({
    queryKey: readsKey(workspaceId, channelId),
    // Store the BARE array so the live `channel.read` upsert (setQueryData of an
    // array) operates on the same shape — otherwise receipts only appear on
    // refresh, never live.
    queryFn: async () => {
      const { reads } = await apiFetch<{ reads: ChannelReadDTO[] }>(
        `/api/workspaces/${workspaceId}/channels/${channelId}/reads`,
      );
      return reads;
    },
    staleTime: Infinity,
  });
}

/**
 * Upsert a user's read cursor (monotonic: never moves backwards). Pure so the
 * realtime reducer is unit-testable.
 */
export function upsertRead(
  reads: ChannelReadDTO[] | undefined,
  userId: string,
  lastReadSeq: number,
): ChannelReadDTO[] {
  const list = reads ?? [];
  const i = list.findIndex((r) => r.userId === userId);
  if (i < 0) return [...list, { userId, lastReadSeq }];
  if (list[i]!.lastReadSeq >= lastReadSeq) return list; // already as far / further
  const next = list.slice();
  next[i] = { userId, lastReadSeq };
  return next;
}

/**
 * Who has seen the message at `seq` — members whose cursor reached it, minus the
 * excluded ids (the viewer + the message's author). The set that drives the
 * "Seen by" read-line.
 */
export function readersOf(
  reads: ChannelReadDTO[] | undefined,
  seq: number,
  exclude: ReadonlyArray<string>,
): string[] {
  const ex = new Set(exclude);
  return (reads ?? [])
    .filter((r) => !ex.has(r.userId) && r.lastReadSeq >= seq)
    .map((r) => r.userId);
}
