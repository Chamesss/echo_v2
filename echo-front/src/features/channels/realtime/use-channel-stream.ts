import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isChannelEvent, type RealtimeEvent } from "@server/infrastructure/realtime/protocol";
import { useSession } from "@/lib/auth-client";
import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";
import { fetchCatchUp } from "../api/use-messages";
import { messagesKey, readsKey } from "../api/keys";
import { upsertRead, type ChannelReadDTO } from "../api/use-reads";
import { clearConversationUnread } from "../api/read-sync";
import { mergeMessage, OPTIMISTIC_SEQ, type EchoMessage } from "./message-cache";
import { useRealtime } from "./realtime-context";

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

  const key = messagesKey(workspace.id, channelId);

  // Reseed the clock when the channel changes — from the cache's actual
  // high-water mark (the highest updatedSeq we've already applied), NOT the
  // channel DTO's lastSeq. The DTO can be stale-high (a catch-up would then fetch
  // nothing and miss messages that landed while this channel was closed) or
  // stale-low; the cache is the honest record of what we've shown. Falls back to
  // the DTO only when nothing is cached yet (first open).
  useEffect(() => {
    const cached = qc.getQueryData<EchoMessage[]>(key);
    const cacheMax = cached?.reduce(
      (max, m) => (m.seq === OPTIMISTIC_SEQ ? max : Math.max(max, m.updatedSeq)),
      0,
    );
    lastClock.current = cacheMax && cacheMax > 0 ? cacheMax : channelLastSeq;
    // intentionally keyed on channelId only
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const runCatchUp = useCallback(async () => {
    if (catchingUp.current) return;
    catchingUp.current = true;
    try {
      let done = false;
      while (!done) {
        const messages = await fetchCatchUp(workspace.id, channelId, lastClock.current, CATCHUP_LIMIT);
        if (messages.length === 0) break;
        qc.setQueryData<EchoMessage[]>(key, (old) =>
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
    (event: RealtimeEvent) => {
      // Workspace-wide events (roster changes) are handled elsewhere; this stream
      // only reconciles its own channel's message timeline.
      if (!isChannelEvent(event) || event.channelId !== channelId) return;

      if (event.kind === "typing") {
        // Ephemeral, and it carries no `updatedSeq` — so it must never reach the
        // clock logic below, where `undefined` slips past BOTH comparisons
        // (`undefined <= n` and `undefined > n` are each false) and hands
        // `mergeMessage` an undefined message. Owned by `useTypingParticipants`;
        // there is nothing to reconcile here.
        return;
      }

      if (event.kind === "channel.read") {
        // Live receipts: record this member's cursor for the open channel.
        qc.setQueryData<ChannelReadDTO[]>(readsKey(workspace.id, channelId), (old) =>
          upsertRead(old, event.userId, event.lastReadSeq),
        );
        // My own read clears the unread badge AND the workspace roll-up (in sync,
        // idempotent with useMarkRead's optimistic clear).
        if (event.userId === myUserId) {
          clearConversationUnread(qc, workspace.id, channelId);
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
      qc.setQueryData<EchoMessage[]>(key, (old) => mergeMessage(old ?? [], event.message, allowInsert));
      // NOTE: unread counting is owned by the awareness (user) socket's
      // `unread.bump` — see NotificationsProvider. We deliberately do NOT bump
      // unread here, or the open channel would double-count (workspace socket +
      // user socket). This stream only reconciles the message timeline.
      lastClock.current = seqv;
    },
    [channelId, key, qc, workspace.id, myUserId, runCatchUp],
  );

  useEffect(() => {
    client.subscribe(channelId);
    // Revalidate on (re)mount: switching channels unmounts this stream, so any
    // messages that landed while it was closed were never applied. Pull them now
    // (since the cache's high-water mark) — a non-destructive merge that keeps
    // optimistic rows + paged-in history, so it never clobbers live state.
    void runCatchUp();
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
