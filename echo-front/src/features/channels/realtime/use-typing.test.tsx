import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeEvent } from "@server/infrastructure/realtime/protocol";

/**
 * Typing is the one piece of state here with no server representation — no
 * cache, no invalidation, no reconciliation. What keeps it honest is a pair of
 * timings: the emitter re-announces every 3s and the receiver forgets you after
 * 5s, so a continuous typist always refreshes before expiring, while a client
 * that vanishes mid-sentence fades out on its own.
 *
 * These tests drive both halves against a fake socket.
 */

// A stand-in for `WorkspaceRealtime`: records what was sent, and lets a test
// push events back as if the server had broadcast them.
const listeners = new Set<(e: RealtimeEvent) => void>();
const sent: Array<{ channelId: string; state: string }> = [];
const client = {
  typing: (channelId: string, state: "start" | "stop") => sent.push({ channelId, state }),
  onEvent: (fn: (e: RealtimeEvent) => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

vi.mock("./realtime-context", () => ({ useRealtime: () => ({ client, status: "open" }) }));

const session = vi.hoisted(() => ({ id: "me" }));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: session.id } } }),
}));

import { useTypingEmitter, useTypingParticipants } from "./use-typing";

const CHANNEL = "c1";

function emit(event: RealtimeEvent) {
  act(() => {
    for (const fn of listeners) fn(event);
  });
}

function typingEvent(userId: string, state: "start" | "stop", channelId = CHANNEL): RealtimeEvent {
  return { kind: "typing", channelId, userId, state };
}

beforeEach(() => {
  vi.useFakeTimers();
  listeners.clear();
  sent.length = 0;
  session.id = "me";
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useTypingEmitter", () => {
  it("sends one start per throttle window, however fast you type", () => {
    const { result } = renderHook(() => useTypingEmitter(CHANNEL));

    act(() => {
      result.current.onInput();
      result.current.onInput();
      result.current.onInput();
    });
    expect(sent).toEqual([{ channelId: CHANNEL, state: "start" }]);

    // Past the 3s window → the next keystroke re-announces.
    act(() => {
      vi.advanceTimersByTime(3_100);
      result.current.onInput();
    });
    expect(sent.filter((f) => f.state === "start")).toHaveLength(2);
  });

  it("sends stop immediately and reopens the throttle window", () => {
    const { result } = renderHook(() => useTypingEmitter(CHANNEL));

    act(() => result.current.onInput());
    act(() => result.current.stop());
    // A stop resets the throttle, so the very next keystroke announces again
    // rather than being swallowed by the window the first start opened.
    act(() => result.current.onInput());

    expect(sent).toEqual([
      { channelId: CHANNEL, state: "start" },
      { channelId: CHANNEL, state: "stop" },
      { channelId: CHANNEL, state: "start" },
    ]);
  });

  it("sends stop on unmount so the indicator doesn't hang for everyone else", () => {
    const { result, unmount } = renderHook(() => useTypingEmitter(CHANNEL));
    act(() => result.current.onInput());
    sent.length = 0;

    unmount();

    expect(sent).toEqual([{ channelId: CHANNEL, state: "stop" }]);
  });
});

describe("useTypingParticipants", () => {
  it("collects typists and drops them on stop", () => {
    const { result } = renderHook(() => useTypingParticipants(CHANNEL));

    emit(typingEvent("alice", "start"));
    emit(typingEvent("bob", "start"));
    expect(result.current.sort()).toEqual(["alice", "bob"]);

    emit(typingEvent("alice", "stop"));
    expect(result.current).toEqual(["bob"]);
  });

  it("never shows me my own typing", () => {
    const { result } = renderHook(() => useTypingParticipants(CHANNEL));
    emit(typingEvent("me", "start"));
    expect(result.current).toEqual([]);
  });

  it("ignores another channel's typing", () => {
    const { result } = renderHook(() => useTypingParticipants(CHANNEL));
    emit(typingEvent("alice", "start", "some-other-channel"));
    expect(result.current).toEqual([]);
  });

  it("expires a typist whose stop never arrived", () => {
    // NOTIFY is at-most-once and a tab can crash mid-sentence, so the TTL is the
    // only thing guaranteeing the indicator ever clears.
    const { result } = renderHook(() => useTypingParticipants(CHANNEL));

    emit(typingEvent("alice", "start"));
    expect(result.current).toEqual(["alice"]);

    act(() => vi.advanceTimersByTime(6_000));
    expect(result.current).toEqual([]);
  });

  it("keeps a continuous typist alive across the TTL", () => {
    // The throttle (3s) is deliberately shorter than the TTL (5s): someone who
    // keeps typing re-announces before they can expire, so they never blink out.
    const { result } = renderHook(() => useTypingParticipants(CHANNEL));

    emit(typingEvent("alice", "start"));
    act(() => vi.advanceTimersByTime(3_000));
    emit(typingEvent("alice", "start")); // the emitter's next throttle tick
    act(() => vi.advanceTimersByTime(3_000));

    expect(result.current).toEqual(["alice"]);
  });

  it("clears everything when the channel changes", () => {
    const { result, rerender } = renderHook(({ id }) => useTypingParticipants(id), {
      initialProps: { id: CHANNEL },
    });
    emit(typingEvent("alice", "start"));
    expect(result.current).toEqual(["alice"]);

    rerender({ id: "c2" });

    expect(result.current).toEqual([]);
  });

  it("unsubscribes from the socket on unmount", () => {
    const { unmount } = renderHook(() => useTypingParticipants(CHANNEL));
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
