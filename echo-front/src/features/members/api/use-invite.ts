import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AcceptResult, InviteInfo } from "@server/modules/members/invites.service";
import { apiFetch } from "@/lib/api";
import { myWorkspacesKey } from "@/features/workspaces/api/use-my-workspaces";

export type { InviteInfo };

/**
 * View an invite by its token. PUBLIC endpoint — works for a logged-out invitee
 * (the accept-invite page + the invite-aware sign-up form both read it). No fetch
 * when there's no token (e.g. a plain /register without ?invite=).
 */
export function useInvite(token: string) {
  return useQuery({
    queryKey: ["invite", token],
    queryFn: () => apiFetch<InviteInfo>(`/api/invites/${token}`),
    enabled: token.length > 0,
    retry: false,
  });
}

/** Accept an invite → creates the membership for the signed-in user. */
export function useAcceptInvite(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<AcceptResult>(`/api/invites/${token}/accept`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: myWorkspacesKey }),
  });
}
