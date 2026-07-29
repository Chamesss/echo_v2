import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DirectMessageDTO } from "@server/modules/channels/dm.service";
import { apiFetch } from "@/lib/api";

export type { DirectMessageDTO };

export const dmsKey = (workspaceId: string) =>
  ["ws", workspaceId, "dms"] as const;

/**
 * Fetcher for `dmsKey`, exported so every observer of that key can pass the
 * SAME `queryFn` — including `useWorkspaceUnread`, which only reads the cache
 * and never fetches. See the note there for why a cache-only observer still
 * needs one.
 */
export async function fetchDms(
  workspaceId: string,
): Promise<DirectMessageDTO[]> {
  const { dms } = await apiFetch<{ dms: DirectMessageDTO[] }>(
    `/api/workspaces/${workspaceId}/dms`,
  );
  return dms;
}

/**
 * The caller's direct & group messages. The cache stores the BARE array (not the
 * `{ dms }` envelope) so the realtime updaters that `setQueryData` an array —
 * unread bump/clear — operate on the same shape they read.
 */
export function useDirectMessages(workspaceId: string) {
  return useQuery({
    queryKey: dmsKey(workspaceId),
    queryFn: () => fetchDms(workspaceId),
  });
}

/** Open (or create) a DM with the given participants; idempotent server-side. */
export function useOpenDm(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) =>
      apiFetch<DirectMessageDTO>(`/api/workspaces/${workspaceId}/dms`, {
        method: "POST",
        body: { userIds },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: dmsKey(workspaceId) }),
  });
}
