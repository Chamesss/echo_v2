import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { myWorkspacesKey } from "./use-my-workspaces";

/**
 * DELETE /api/workspaces/:id — permanent deletion + tenant teardown. Owner-only
 * server-side. On success we invalidate the workspace list; the caller
 * navigates away from the now-deleted workspace.
 */
export function useDeleteWorkspace(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>(`/api/workspaces/${workspaceId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: myWorkspacesKey }),
  });
}
