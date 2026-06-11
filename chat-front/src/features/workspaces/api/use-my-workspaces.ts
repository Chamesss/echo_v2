import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface Workspace {
  id: string;
  slug: string;
  role: "admin" | "member";
}

/**
 * Query key for the current user's workspace list.
 *
 * Exported so mutations (create, leave, delete) can invalidate this exact
 * key after they succeed, forcing the index page and any switcher to refetch.
 */
export const myWorkspacesKey = ["workspaces", "mine"] as const;

/**
 * Fetches the list of workspaces the signed-in user belongs to.
 *
 * Called by `routes/index.tsx` to decide where to redirect after auth
 * resolves (empty list → /workspaces/create, otherwise → /dashboard/:id).
 * The user must already be authenticated when this fires; calling it on a
 * public page would return 401.
 */
export function useMyWorkspaces() {
  return useQuery({
    queryKey: myWorkspacesKey,
    queryFn: () => apiFetch<Workspace[]>("/api/workspaces"),
  });
}
