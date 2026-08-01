import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeEvent } from "@server/infrastructure/realtime/protocol";
import { useSession } from "@/lib/auth-client";
import { useRealtime } from "./realtime-context";

/**
 * Typing indicators for the open conversation.
 *
 * Both halves live here because their two constants are a matched pair: the
 * emitter re-announces every `THROTTLE_MS` and the receiver forgets you after
 * `TTL_MS`, so THROTTLE must stay comfortably under TTL or a continuous typist
 * would blink out between ticks.
 *
 * Everything is ephemeral React state, never React Query — there's no server
 * representation to cache, invalidate or reconcile, and the whole lifetime of a
 * value here is a few seconds.
 */

/** Don't re-announce "still typing" more often than this. */
const THROTTLE_MS = 3_000;
/** Forget a typist we haven't heard from in this long, even without a "stop". */
const TTL_MS = 5_000;
/** How often to sweep expired typists out of state. */
const SWEEP_MS = 1_000;

/**
 * Outbound half: turns keystrokes into at most one frame per `THROTTLE_MS`.
 *
 * The throttle lives here rather than at the call site so the composer can call
 * `onInput()` on every change without thinking about it.
 */
export function useTypingEmitter(channelId: string) {
  const { client } = useRealtime();
  const lastSentAt = useRef(0);

  const stop = useCallback(() => {
    lastSentAt.current = 0; // next keystroke opens a fresh throttle window
    client.typing(channelId, "stop");
  }, [client, channelId]);

  const onInput = useCallback(() => {
    const now = Date.now();
    if (now - lastSentAt.current < THROTTLE_MS) return;
    lastSentAt.current = now;
    client.typing(channelId, "start");
  }, [client, channelId]);

  // Leaving the conversation (or unmounting entirely) has to clear the
  // indicator for everyone else — otherwise it hangs there until their TTL runs
  // out. `stop` is stable per channel, so this fires on channel change too.
  useEffect(() => stop, [stop]);

  return { onInput, stop };
}

/**
 * Inbound half: who is currently typing in this channel, excluding me.
 *
 * Registers its own `client.onEvent` listener rather than threading through
 * `useChannelStream` — `onEvent` fans out to a listener Set, so the two hooks
 * observe the same socket independently with no coupling.
 *
 * TWO independent clears, because NOTIFY is at-most-once and a "stop" may never
 * arrive (dropped frame, closed laptop, crashed tab):
 *   - an explicit "stop" removes the typist immediately;
 *   - a TTL sweep removes anyone unheard-from for `TTL_MS`.
 */
export function useTypingParticipants(channelId: string): string[] {
  const { client } = useRealtime();
  const { data: session } = useSession();
  const myUserId = session?.user.id;

  // userId → timestamp of the last "start" we saw.
  const [typists, setTypists] = useState<Record<string, number>>({});

  useEffect(() => {
    setTypists({}); // channel changed → nothing carries over

    const offEvent = client.onEvent((event: RealtimeEvent) => {
      if (event.kind !== "typing") return;
      if (event.channelId !== channelId) return;
      if (event.userId === myUserId) return; // never show yourself

      setTypists((prev) => {
        if (event.state === "stop") {
          if (!(event.userId in prev)) return prev;
          const next = { ...prev };
          delete next[event.userId];
          return next;
        }
        return { ...prev, [event.userId]: Date.now() };
      });
    });

    const sweep = setInterval(() => {
      const cutoff = Date.now() - TTL_MS;
      setTypists((prev) => {
        const kept = Object.entries(prev).filter(([, at]) => at > cutoff);
        // Same reference when nothing expired → no re-render.
        return kept.length === Object.keys(prev).length
          ? prev
          : Object.fromEntries(kept);
      });
    }, SWEEP_MS);

    return () => {
      offEvent();
      clearInterval(sweep);
    };
  }, [client, channelId, myUserId]);

  return Object.keys(typists);
}
