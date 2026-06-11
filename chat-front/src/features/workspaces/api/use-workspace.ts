import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "@/lib/api";
import type { Workspace } from "./use-my-workspaces";

/**
 * Query key builder for an individual workspace lookup.
 *
 * Exported so future mutations (rename, update settings) can invalidate
 * just one workspace's cache entry without dropping the others.
 */
export const workspaceKey = (id: string) => ["workspaces", id] as const;

/**
 * Fetches a single workspace by id, with the requester's role attached.
 *
 * Used by `WorkspaceLayout` to verify the URL's `:workspaceId` is one the user
 * actually belongs to (the backend's `loadWorkspace` middleware enforces the
 * same check server-side) and to feed the AppShell — via the workspace context
 * — with the workspace name + role.
 *
 * 403 (not a member) and 404 (no such workspace) are both terminal — no
 * point retrying. Other errors get the default single-retry behavior.
 */
export function useWorkspace(workspaceId: string) {
  return useQuery({
    queryKey: workspaceKey(workspaceId),
    queryFn: () => apiFetch<Workspace>(`/api/workspaces/${workspaceId}`),
    enabled: workspaceId.length > 0,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        return false;
      }
      return failureCount < 1;
    },
  });
}
