import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChannelDTO, ChannelMemberDTO } from "@server/modules/channels/channels.service";
import { apiFetch } from "@/lib/api";
import { channelMembersKey, channelsKey } from "./keys";

export type { ChannelMemberDTO };

const channelPath = (workspaceId: string, channelId: string) =>
  `/api/workspaces/${workspaceId}/channels/${channelId}`;

interface UpdateChannelInput {
  channelId: string;
  name?: string;
  topic?: string;
  archived?: boolean;
}

/** Rename / set topic / archive (admin or creator). Invalidates the list. */
export function useUpdateChannel(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, ...body }: UpdateChannelInput) =>
      apiFetch<ChannelDTO>(channelPath(workspaceId, channelId), { method: "PATCH", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelsKey(workspaceId) }),
  });
}

/** Hard-delete a channel (admin or creator). */
export function useDeleteChannel(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) =>
      apiFetch<void>(channelPath(workspaceId, channelId), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelsKey(workspaceId) }),
  });
}

/** Leave a channel (any member). */
export function useLeaveChannel(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) =>
      apiFetch<void>(`${channelPath(workspaceId, channelId)}/leave`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelsKey(workspaceId) }),
  });
}

/** Members of a channel (must be a member to read). */
export function useChannelMembers(workspaceId: string, channelId: string, enabled = true) {
  return useQuery({
    queryKey: channelMembersKey(workspaceId, channelId),
    queryFn: () =>
      apiFetch<{ members: ChannelMemberDTO[] }>(`${channelPath(workspaceId, channelId)}/members`),
    select: (d) => d.members,
    enabled,
  });
}

/** Add a workspace member to a channel (any channel member may add). */
export function useAddChannelMember(workspaceId: string, channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<void>(`${channelPath(workspaceId, channelId)}/members`, {
        method: "POST",
        body: { userId },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: channelMembersKey(workspaceId, channelId) });
      qc.invalidateQueries({ queryKey: channelsKey(workspaceId) });
    },
  });
}

/** Remove a member from a channel (admin or creator). */
export function useRemoveChannelMember(workspaceId: string, channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<void>(`${channelPath(workspaceId, channelId)}/members/${userId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: channelMembersKey(workspaceId, channelId) });
      qc.invalidateQueries({ queryKey: channelsKey(workspaceId) });
    },
  });
}
