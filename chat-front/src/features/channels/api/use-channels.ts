import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChannelDTO } from "@server/modules/channels/channels.service";
import { apiFetch } from "@/lib/api";
import { channelsKey } from "./keys";

export type { ChannelDTO };

/** Channels visible to the user in this workspace (public + joined private). */
export function useChannels(workspaceId: string) {
  return useQuery({
    queryKey: channelsKey(workspaceId),
    queryFn: () => apiFetch<ChannelDTO[]>(`/api/workspaces/${workspaceId}/channels`),
  });
}

export function useCreateChannel(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { type: "public" | "private"; name: string }) =>
      apiFetch<ChannelDTO>(`/api/workspaces/${workspaceId}/channels`, {
        method: "POST",
        body: input,
      }),
    onSuccess: (channel) =>
      qc.setQueryData<ChannelDTO[]>(channelsKey(workspaceId), (old) => [...(old ?? []), channel]),
  });
}

export function useJoinChannel(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) =>
      apiFetch<ChannelDTO>(`/api/workspaces/${workspaceId}/channels/${channelId}/join`, {
        method: "POST",
      }),
    onSuccess: (channel) =>
      qc.setQueryData<ChannelDTO[]>(channelsKey(workspaceId), (old) =>
        (old ?? []).map((c) => (c.id === channel.id ? channel : c)),
      ),
  });
}
