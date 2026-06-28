import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DirectMessageDTO } from "@server/modules/channels/dm.service";
import { apiFetch } from "@/lib/api";

export type { DirectMessageDTO };

export const dmsKey = (workspaceId: string) => ["ws", workspaceId, "dms"] as const;

/**
 * The caller's direct & group messages. The cache stores the BARE array (not the
 * `{ dms }` envelope) so the realtime updaters that `setQueryData` an array —
 * unread bump/clear — operate on the same shape they read.
 */
export function useDirectMessages(workspaceId: string) {
  return useQuery({
    queryKey: dmsKey(workspaceId),
    queryFn: async () => {
      const { dms } = await apiFetch<{ dms: DirectMessageDTO[] }>(
        `/api/workspaces/${workspaceId}/dms`,
      );
      return dms;
    },
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
