import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PendingInvite } from "@server/modules/members/invites.service";
import { apiFetch } from "@/lib/api";
import { invitesKey } from "./keys";

export type { PendingInvite };

/** Admin: pending (unaccepted, unexpired) invites for the workspace. */
export function useInvites(workspaceId: string) {
  return useQuery({
    queryKey: invitesKey(workspaceId),
    queryFn: () => apiFetch<{ invites: PendingInvite[] }>(`/api/workspaces/${workspaceId}/invites`),
    select: (d) => d.invites,
  });
}

/** What POST /invites returns (the raw token is never sent to the client). */
export interface CreatedInviteSummary {
  id: string;
  email: string;
  role: "admin" | "member";
  expiresAt: string;
}

/** Admin: invite an email address (emails a tokenized accept link). */
export function useCreateInvite(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; role: "admin" | "member" }) =>
      apiFetch<CreatedInviteSummary>(`/api/workspaces/${workspaceId}/invites`, {
        method: "POST",
        body: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: invitesKey(workspaceId) }),
  });
}
