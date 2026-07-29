import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChannelDTO } from "@server/modules/channels/channels.service";
import { apiFetch } from "@/lib/api";
import { channelsKey } from "./keys";

export type { ChannelDTO };

/**
 * Fetcher for `channelsKey`, exported for the same reason as `fetchDms`: every
 * observer of the key supplies the same `queryFn`, including the cache-only one
 * in `useWorkspaceUnread`.
 */
export function fetchChannels(workspaceId: string): Promise<ChannelDTO[]> {
  return apiFetch<ChannelDTO[]>(`/api/workspaces/${workspaceId}/channels`);
}

/** Channels visible to the user in this workspace (public + joined private). */
export function useChannels(workspaceId: string) {
  return useQuery({
    queryKey: channelsKey(workspaceId),
    queryFn: () => fetchChannels(workspaceId),
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
