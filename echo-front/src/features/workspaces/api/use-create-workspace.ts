import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { myWorkspacesKey } from "./use-my-workspaces";
import type { CreateWorkspaceInput } from "../schemas";

interface CreateWorkspaceResult {
  workspaceId: string;
  schemaName: string;
}

/**
 * Mutation wrapper around POST /api/workspaces.
 *
 * Used by `CreateWorkspaceForm`. On success we invalidate the my-workspaces
 * cache so the next render of the index page sees the new workspace; the
 * form itself navigates straight to /dashboard/:newId rather than bouncing
 * through /, so the invalidation is mostly a hygiene step for switching back.
 *
 * 409 slug-taken errors arrive as `ApiError` with `code === 'slug_taken'`;
 * the form catches that specifically and surfaces it as an inline field
 * error instead of a toast.
 */
export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkspaceInput) =>
      apiFetch<CreateWorkspaceResult>("/api/workspaces", {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: myWorkspacesKey });
    },
  });
}
