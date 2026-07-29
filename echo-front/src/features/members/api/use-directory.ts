import { useQuery } from "@tanstack/react-query";
import type { Directory } from "@server/modules/members/directory.service";
import { apiFetch } from "@/lib/api";
import { directoryKey } from "./keys";

export type { Directory };

/**
 * Workspace member directory: `userId → {name, image}`, for resolving message
 * authors to names/avatars. Backed by the server's cached endpoint; we also
 * hold it stale for a minute since names rarely change.
 */
export function useDirectory(workspaceId: string) {
  return useQuery({
    queryKey: directoryKey(workspaceId),
    queryFn: () =>
      apiFetch<{ directory: Directory }>(`/api/workspaces/${workspaceId}/directory`),
    select: (d) => d.directory,
    staleTime: 60_000,
  });
}
