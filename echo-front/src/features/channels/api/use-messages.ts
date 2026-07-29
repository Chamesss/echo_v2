import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AttachmentWire, MessageWire } from "@server/infrastructure/realtime/protocol";
import { apiFetch } from "@/lib/api";
import {
  mergeBatch,
  mergeMessage,
  optimisticMessage,
  sortMessages,
  OPTIMISTIC_SEQ,
  type EchoMessage,
} from "../realtime/message-cache";
import { historyKey, messagesKey } from "./keys";
import { clearConversationUnread } from "./read-sync";

const HISTORY_PAGE = 50;

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
  const qc = useQueryClient();
  return useQuery({
    queryKey: messagesKey(workspaceId, channelId),
    queryFn: async () => {
      const { messages } = await apiFetch<MessagesResponse>(
        `${base(workspaceId, channelId)}?limit=${HISTORY_PAGE}`,
      );
      // A full page back ⇒ there may be older history to page in; a short page
      // means this IS the whole conversation, so hide "Load earlier messages".
      qc.setQueryData<boolean>(historyKey(workspaceId, channelId), messages.length >= HISTORY_PAGE);
      return sortMessages(messages as EchoMessage[]);
    },
    staleTime: Infinity,
  });
}

/**
 * Keyset history pagination. Loads the page of messages older than the oldest
 * one currently in the cache (`?before=<minSeq>`) and prepends it to the same
 * flat array the realtime stream reconciles against — so live updates and
 * back-scroll share one cache shape. `hasMore` flips false once a short page
 * comes back. Optimistic rows (seq = MAX) are ignored when finding the floor.
 */
export function useOlderMessages(workspaceId: string, channelId: string) {
  const qc = useQueryClient();
  const key = messagesKey(workspaceId, channelId);
  const [isLoading, setIsLoading] = useState(false);

  // `hasMore` is owned by the `historyKey` cache: the initial load seeds it
  // (full page ⇒ true), and paging older updates it. Read reactively so the
  // button hides the instant we know there's no older history. Defaults to
  // false (no button) until the initial load decides — avoids a wrong flash on
  // a fresh/empty channel.
  const { data: hasMore = false } = useQuery({
    queryKey: historyKey(workspaceId, channelId),
    queryFn: () => false,
    enabled: false,
    initialData: false,
  });

  const loadOlder = useCallback(async () => {
    if (isLoading || !hasMore) return;
    const current = qc.getQueryData<EchoMessage[]>(key) ?? [];
    const realSeqs = current.filter((m) => m.seq !== OPTIMISTIC_SEQ).map((m) => m.seq);
    if (realSeqs.length === 0) return;
    const before = Math.min(...realSeqs);

    setIsLoading(true);
    try {
      const { messages } = await apiFetch<MessagesResponse>(
        `${base(workspaceId, channelId)}?before=${before}&limit=${HISTORY_PAGE}`,
      );
      qc.setQueryData<boolean>(historyKey(workspaceId, channelId), messages.length >= HISTORY_PAGE);
      qc.setQueryData<EchoMessage[]>(key, (old) => mergeBatch(old ?? [], messages));
    } finally {
      setIsLoading(false);
    }
  }, [qc, key, workspaceId, channelId, isLoading, hasMore]);

  return { loadOlder, isLoading, hasMore };
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
    mutationFn: async ({
      body,
      attachments = [],
      optimisticAttachments = [],
    }: {
      body: string;
      /** `{ key, filename }` refs for already-uploaded files (server HEAD-verifies). */
      attachments?: { key: string; filename: string }[];
      /** Resolved wire attachments for the optimistic row (already on S3). */
      optimisticAttachments?: AttachmentWire[];
    }) => {
      const clientId = crypto.randomUUID();
      const optimistic = optimisticMessage({
        clientId,
        channelId,
        authorId,
        body,
        attachments: optimisticAttachments,
      });
      qc.setQueryData<EchoMessage[]>(key, (old) => mergeMessage(old ?? [], optimistic, true));

      try {
        const message = await apiFetch<MessageWire>(base(workspaceId, channelId), {
          method: "POST",
          body: { clientId, body, attachments },
        });
        qc.setQueryData<EchoMessage[]>(key, (old) => mergeMessage(old ?? [], message, true));
        return message;
      } catch (err) {
        qc.setQueryData<EchoMessage[]>(key, (old) =>
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
    mutationFn: (input: {
      messageId: string;
      body: string;
      /** Existing attachment ids to keep (omit → leave attachments untouched). */
      keepAttachmentIds?: string[];
      /** Newly-uploaded refs to add (server HEAD-verifies). */
      attachments?: { key: string; filename: string }[];
    }) =>
      apiFetch<MessageWire>(`${base(workspaceId, channelId)}/${input.messageId}`, {
        method: "PATCH",
        body: {
          body: input.body,
          keepAttachmentIds: input.keepAttachmentIds,
          attachments: input.attachments,
        },
      }),
    onSuccess: (message) =>
      qc.setQueryData<EchoMessage[]>(key, (old) => mergeMessage(old ?? [], message, false)),
  });
}

export function useDeleteMessage(workspaceId: string, channelId: string) {
  const qc = useQueryClient();
  const key = messagesKey(workspaceId, channelId);
  return useMutation({
    mutationFn: (messageId: string) =>
      apiFetch<MessageWire>(`${base(workspaceId, channelId)}/${messageId}`, { method: "DELETE" }),
    onSuccess: (message) =>
      qc.setQueryData<EchoMessage[]>(key, (old) => mergeMessage(old ?? [], message, false)),
  });
}

/** Advance the read cursor; zero this conversation's unread (channel OR DM list). */
export function useMarkRead(workspaceId: string, channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    // The read cursor is channel-level — `/channels/:id/read`, NOT under
    // `/messages` (`base`). Posting to the wrong path 404s silently and the
    // cursor never advances (unread never clears, no receipts).
    mutationFn: (seq: number) =>
      apiFetch<{ lastReadSeq: number }>(
        `/api/workspaces/${workspaceId}/channels/${channelId}/read`,
        { method: "POST", body: { seq } },
      ),
    // Clears the per-channel badge AND the workspace roll-up, consistently.
    onSuccess: () => clearConversationUnread(qc, workspaceId, channelId),
  });
}
