import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MemberDTO } from "@server/modules/members/members.service";
import { apiFetch } from "@/lib/api";
import { myWorkspacesKey } from "@/features/workspaces/api/use-my-workspaces";
import { membersKey } from "./keys";

export type { MemberDTO };

type Role = "admin" | "member";

/** Workspace roster (name/email/avatar/role/owner). Any member may read it. */
export function useMembers(workspaceId: string) {
  return useQuery({
    queryKey: membersKey(workspaceId),
    queryFn: () => apiFetch<{ members: MemberDTO[] }>(`/api/workspaces/${workspaceId}/members`),
    select: (d) => d.members,
  });
}

/** Admin: add an existing user by email (instant). */
export function useAddMember(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; role: Role }) =>
      apiFetch<MemberDTO>(`/api/workspaces/${workspaceId}/members`, { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: membersKey(workspaceId) }),
  });
}

/** Admin: change a member's role. */
export function useChangeMemberRole(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      apiFetch<MemberDTO>(`/api/workspaces/${workspaceId}/members/${userId}`, {
        method: "PATCH",
        body: { role },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: membersKey(workspaceId) }),
  });
}

/** Admin: remove a member. */
export function useRemoveMember(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<void>(`/api/workspaces/${workspaceId}/members/${userId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: membersKey(workspaceId) }),
  });
}

/** Leave the workspace (any member except the owner). */
export function useLeaveWorkspace(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>(`/api/workspaces/${workspaceId}/leave`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: myWorkspacesKey }),
  });
}
