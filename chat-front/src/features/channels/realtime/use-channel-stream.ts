import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ChannelEvent } from "@server/infrastructure/realtime/protocol";
import { useSession } from "@/lib/auth-client";
import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";
import { fetchCatchUp } from "../api/use-messages";
import { channelsKey, messagesKey } from "../api/keys";
import { mergeMessage, type ChatMessage } from "./message-cache";
import { useRealtime } from "./realtime-context";
import type { ChannelDTO } from "../api/use-channels";

const CATCHUP_LIMIT = 100;

/**
 * Wires a channel's live updates into the React Query cache with the versioning
 * protocol that lets us NOT trust the socket:
 *
 *   - track `lastClock` (the channel change-clock we've applied; seeded from the
 *     channel's `lastSeq` on open);
 *   - in-order event (`updatedSeq === lastClock + 1`) → apply + advance;
 *   - older event (`<= lastClock`) → already seen, drop (dedupe);
 *   - gap (`> lastClock + 1`) → a message was missed → REST catch-up `?since=`;
 *   - on reconnect → catch-up from `lastClock` to fill anything missed offline.
 *
 * The socket only accelerates; every gap is healed from the authoritative DB
 * sequence, so a dropped/duplicated frame can never corrupt the timeline.
 */
export function useChannelStream(channelId: string, channelLastSeq: number) {
  const { client } = useRealtime();
  const workspace = useCurrentWorkspace();
  const { data: session } = useSession();
  const qc = useQueryClient();
  const myUserId = session?.user.id;

  const lastClock = useRef(channelLastSeq);
  const catchingUp = useRef(false);

  // Reseed the clock only when the channel itself changes — never from a later
  // (possibly stale) DTO update, since events/catch-up own it after open.
  useEffect(() => {
    lastClock.current = channelLastSeq;
    // intentionally keyed on channelId only
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const key = messagesKey(workspace.id, channelId);

  const runCatchUp = useCallback(async () => {
    if (catchingUp.current) return;
    catchingUp.current = true;
    try {
      let done = false;
      while (!done) {
        const messages = await fetchCatchUp(workspace.id, channelId, lastClock.current, CATCHUP_LIMIT);
        if (messages.length === 0) break;
        qc.setQueryData<ChatMessage[]>(key, (old) =>
          messages.reduce((acc, m) => mergeMessage(acc, m, true), old ?? []),
        );
        lastClock.current = messages.reduce((max, m) => Math.max(max, m.updatedSeq), lastClock.current);
        if (messages.length < CATCHUP_LIMIT) done = true;
      }
    } finally {
      catchingUp.current = false;
    }
  }, [qc, key, workspace.id, channelId]);

  const handleEvent = useCallback(
    (event: ChannelEvent) => {
      if (event.channelId !== channelId) return;

      if (event.kind === "channel.read") {
        if (event.userId === myUserId) {
          qc.setQueryData<ChannelDTO[]>(channelsKey(workspace.id), (old) =>
            (old ?? []).map((c) => (c.id === channelId ? { ...c, unread: 0 } : c)),
          );
        }
        return;
      }

      const seqv = event.updatedSeq;
      if (seqv <= lastClock.current) return; // dedupe
      if (seqv > lastClock.current + 1) {
        void runCatchUp(); // gap
        return;
      }
      const allowInsert = event.kind === "message.created";
      qc.setQueryData<ChatMessage[]>(key, (old) => mergeMessage(old ?? [], event.message, allowInsert));
      if (event.kind === "message.created" && event.message.authorId !== myUserId) {
        qc.setQueryData<ChannelDTO[]>(channelsKey(workspace.id), (old) =>
          (old ?? []).map((c) => (c.id === channelId ? { ...c, unread: c.unread + 1 } : c)),
        );
      }
      lastClock.current = seqv;
    },
    [channelId, key, qc, workspace.id, myUserId, runCatchUp],
  );

  useEffect(() => {
    client.subscribe(channelId);
    const offEvent = client.onEvent(handleEvent);
    const offStatus = client.onStatus((status, reconnected) => {
      if (status === "open" && reconnected) void runCatchUp();
    });
    return () => {
      offEvent();
      offStatus();
      client.unsubscribe(channelId);
    };
  }, [client, channelId, handleEvent, runCatchUp]);
}
