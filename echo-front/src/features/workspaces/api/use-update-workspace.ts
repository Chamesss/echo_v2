import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { myWorkspacesKey, type Workspace } from "./use-my-workspaces";
import { workspaceKey } from "./use-workspace";
import type { UpdateWorkspaceInput } from "../schemas";

/**
 * PATCH /api/workspaces/:id — rename. Admin-only server-side. On success we
 * prime the single-workspace cache (so the shell header updates immediately)
 * and invalidate the list.
 */
export function useUpdateWorkspace(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateWorkspaceInput) =>
      apiFetch<Workspace>(`/api/workspaces/${workspaceId}`, { method: "PATCH", body: input }),
    onSuccess: (workspace) => {
      qc.setQueryData(workspaceKey(workspaceId), workspace);
      void qc.invalidateQueries({ queryKey: myWorkspacesKey });
    },
  });
}
