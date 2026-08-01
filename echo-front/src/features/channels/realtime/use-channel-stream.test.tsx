import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { RealtimeEvent } from "@server/infrastructure/realtime/protocol";
import type { EchoMessage } from "./message-cache";

/**
 * The stream under BURST — ten messages inside a second.
 *
 * The protocol's whole promise is that a dropped or reordered frame can't
 * corrupt the timeline, because any gap is healed from the authoritative REST
 * sequence. That promise depends on the catch-up actually running when it's
 * needed. A burst is where it's tested: gaps arrive while a catch-up is already
 * in flight, and a catch-up that started before the newest message existed
 * cannot possibly have fetched it.
 *
 * A hole here isn't only a missing message: the reader never marks read past it,
 * so the sender's "Seen by" never appears.
 */

const WS = "w1";
const CHANNEL = "c1";

const listeners = new Set<(e: RealtimeEvent) => void>();
const client = {
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  onEvent: (fn: (e: RealtimeEvent) => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  onStatus: () => () => {},
};

vi.mock("./realtime-context", () => ({ useRealtime: () => ({ client, status: "open" }) }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "me" } } }) }));
vi.mock("@/features/workspaces/hooks/use-current-workspace", () => ({
  useCurrentWorkspace: () => ({ id: WS }),
}));

const fetchCatchUp = vi.fn();
vi.mock("../api/use-messages", () => ({
  fetchCatchUp: (...args: unknown[]) => fetchCatchUp(...args),
}));

import { useChannelStream } from "./use-channel-stream";
import { messagesKey } from "../api/keys";

function msg(seq: number): EchoMessage {
  return {
    id: `m${seq}`,
    channelId: CHANNEL,
    authorId: "them",
    body: `msg ${seq}`,
    clientId: `cid${seq}`,
    seq,
    updatedSeq: seq,
    version: 1,
    deleted: false,
    createdAt: new Date(2020, 0, 1, 0, 0, seq).toISOString(),
    updatedAt: null,
  };
}

function created(seq: number): RealtimeEvent {
  return { kind: "message.created", channelId: CHANNEL, updatedSeq: seq, message: msg(seq) };
}

function emit(event: RealtimeEvent) {
  act(() => {
    for (const fn of listeners) fn(event);
  });
}

let qc: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** The seqs currently in the timeline cache, in order. */
const seqsInCache = () =>
  (qc.getQueryData<EchoMessage[]>(messagesKey(WS, CHANNEL)) ?? [])
    .map((m) => m.seq)
    .sort((a, b) => a - b);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  listeners.clear();
  fetchCatchUp.mockReset();
  fetchCatchUp.mockResolvedValue([]);
  client.subscribe.mockClear();
});

describe("useChannelStream under a burst", () => {
  it("applies ten in-order messages", async () => {
    // The easy path: no gaps, nothing to heal.
    renderHook(() => useChannelStream(CHANNEL, 0), { wrapper });
    for (let seq = 1; seq <= 10; seq += 1) emit(created(seq));

    expect(seqsInCache()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("heals the timeline when gaps arrive WHILE a catch-up is in flight", async () => {
    // The failure the stress test hit. Frame 6 is dropped (NOTIFY is
    // at-most-once), so 7 opens a gap and starts a catch-up. Frames 8, 9 and 10
    // then land while that fetch is still running — and the fetch was issued
    // before they existed, so it cannot return them. If a catch-up requested
    // during another is DISCARDED rather than queued, 9 and 10 are lost until
    // the next remount, and the reader never marks read past 8.
    let resolveFirst!: (rows: EchoMessage[]) => void;
    fetchCatchUp.mockImplementationOnce(
      () => new Promise<EchoMessage[]>((res) => (resolveFirst = res)),
    );
    // Anything requested afterwards sees the full, settled history.
    fetchCatchUp.mockImplementation(async (_ws, _ch, since: number) =>
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((s) => s > since).map(msg),
    );

    renderHook(() => useChannelStream(CHANNEL, 0), { wrapper });

    for (const seq of [1, 2, 3, 4, 5]) emit(created(seq));
    emit(created(7)); // 6 never arrived → gap → catch-up starts
    for (const seq of [8, 9, 10]) emit(created(seq)); // land mid-flight

    // The in-flight pass only ever saw up to 8.
    await act(async () => {
      resolveFirst([6, 7, 8].map(msg));
    });

    await waitFor(() => expect(seqsInCache()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  });

  it("does not fire a catch-up when nothing is missing", async () => {
    renderHook(() => useChannelStream(CHANNEL, 0), { wrapper });
    fetchCatchUp.mockClear();

    for (let seq = 1; seq <= 10; seq += 1) emit(created(seq));

    expect(fetchCatchUp).not.toHaveBeenCalled();
  });
});
