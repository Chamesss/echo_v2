import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MessageWire } from "@server/infrastructure/realtime/protocol";
import { apiFetch } from "@/lib/api";
import {
  mergeMessage,
  optimisticMessage,
  sortMessages,
  type ChatMessage,
} from "../realtime/message-cache";
import { channelsKey, messagesKey } from "./keys";
import type { ChannelDTO } from "./use-channels";

const base = (workspaceId: string, channelId: string) =>
  `/api/workspaces/${workspaceId}/channels/${channelId}/messages`;

interface MessagesResponse {
  messages: MessageWire[];
}

/**
 * Initial message history for a channel (newest page, returned seq-DESC by the
 * API → stored seq-ASC). `staleTime: Infinity` because freshness is driven by
 * the realtime stream + catch-up, not refetching — a background refetch would
 * clobber live state.
 */
export function useMessages(workspaceId: string, channelId: string) {
  return useQuery({
    queryKey: messagesKey(workspaceId, channelId),
    queryFn: async () => {
      const { messages } = await apiFetch<MessagesResponse>(`${base(workspaceId, channelId)}?limit=50`);
      return sortMessages(messages as ChatMessage[]);
    },
    staleTime: Infinity,
  });
}

/** Catch-up fetch: every message changed after `since`, in clock order. */
export async function fetchCatchUp(
  workspaceId: string,
  channelId: string,
  since: number,
  limit = 100,
): Promise<MessageWire[]> {
  const { messages } = await apiFetch<MessagesResponse>(
    `${base(workspaceId, channelId)}?since=${since}&limit=${limit}`,
  );
  return messages;
}

/**
 * Send a message with an optimistic row. We generate the `clientId` (idempotency
 * key) up front, show the message immediately, then swap in the authoritative
 * server row on confirm (matched by `clientId`). The clock is NOT advanced here
 * — the WS echo / catch-up own that, so a gap is still detected if events were
 * missed between our last-seen clock and this send.
 */
export function useSendMessage(workspaceId: string, channelId: string, authorId: string) {
  const qc = useQueryClient();
  const key = messagesKey(workspaceId, channelId);

  return useMutation({
    mutationFn: async ({ body }: { body: string }) => {
      const clientId = crypto.randomUUID();
      const optimistic = optimisticMessage({ clientId, channelId, authorId, body });
      qc.setQueryData<ChatMessage[]>(key, (old) => mergeMessage(old ?? [], optimistic, true));

      try {
        const message = await apiFetch<MessageWire>(base(workspaceId, channelId), {
          method: "POST",
          body: { clientId, body },
        });
        qc.setQueryData<ChatMessage[]>(key, (old) => mergeMessage(old ?? [], message, true));
        return message;
      } catch (err) {
        qc.setQueryData<ChatMessage[]>(key, (old) =>
          (old ?? []).map((m) => (m.clientId === clientId ? { ...m, pending: false, failed: true } : m)),
        );
        throw err;
      }
    },
  });
}

export function useEditMessage(workspaceId: string, channelId: string) {
  const qc = useQueryClient();
  const key = messagesKey(workspaceId, channelId);
  return useMutation({
    mutationFn: (input: { messageId: string; body: string }) =>
      apiFetch<MessageWire>(`${base(workspaceId, channelId)}/${input.messageId}`, {
        method: "PATCH",
        body: { body: input.body },
      }),
    onSuccess: (message) =>
      qc.setQueryData<ChatMessage[]>(key, (old) => mergeMessage(old ?? [], message, false)),
  });
}

export function useDeleteMessage(workspaceId: string, channelId: string) {
  const qc = useQueryClient();
  const key = messagesKey(workspaceId, channelId);
  return useMutation({
    mutationFn: (messageId: string) =>
      apiFetch<MessageWire>(`${base(workspaceId, channelId)}/${messageId}`, { method: "DELETE" }),
    onSuccess: (message) =>
      qc.setQueryData<ChatMessage[]>(key, (old) => mergeMessage(old ?? [], message, false)),
  });
}

/** Advance the read cursor; zero this channel's unread in the channels list. */
export function useMarkRead(workspaceId: string, channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (seq: number) =>
      apiFetch<{ lastReadSeq: number }>(`${base(workspaceId, channelId)}/read`, {
        method: "POST",
        body: { seq },
      }),
    onSuccess: () =>
      qc.setQueryData<ChannelDTO[]>(channelsKey(workspaceId), (old) =>
        (old ?? []).map((c) => (c.id === channelId ? { ...c, unread: 0 } : c)),
      ),
  });
}
