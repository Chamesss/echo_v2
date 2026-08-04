import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIVENESS_TIMEOUT_MS,
  PING_INTERVAL_MS,
  ReconnectingSocket,
  UNAUTHORIZED_RETRY_MS,
  WATCHDOG_TICK_MS,
  type RealtimeStatus,
} from "./reconnecting-socket";

/**
 * Tests for the connection lifecycle shared by both sockets.
 *
 * The centrepiece is the half-open case: a connection the browser still reports
 * as OPEN but which is carrying no traffic. Nothing in the WebSocket API tells
 * the page about that (protocol ping/pong isn't exposed to JS), so before the
 * watchdog existed this state was permanent — no `onclose`, no reconnect, no
 * catch-up, a silently frozen UI. `detects a half-open socket` is the guard
 * against that regressing.
 */

interface TestEvent {
  kind: string;
}

/** Minimal WebSocket stand-in — jsdom's would try to open a real connection. */
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState: number = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1005 });
  }

  // --- test drivers ---
  accept(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({});
  }

  deliver(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  /** Server-initiated close with an explicit code. */
  serverClose(code: number): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code });
  }
}

class TestSocket extends ReconnectingSocket<{ t: string }, TestEvent> {
  openedCount = 0;
  protected buildUrl(): string {
    return "ws://test/ws";
  }
  protected onOpened(): void {
    this.openedCount += 1;
  }
}

const latest = (): MockWebSocket => {
  const ws = MockWebSocket.instances.at(-1);
  if (!ws) throw new Error("no socket created");
  return ws;
};

const pings = (ws: MockWebSocket): string[] => ws.sent.filter((s) => s.includes('"ping"'));

const setVisibility = (state: "visible" | "hidden"): void => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
};

let socket: TestSocket;

beforeEach(() => {
  vi.useFakeTimers();
  // Deterministic full jitter: delay is always half the cap.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  socket = new TestSocket();
});

afterEach(() => {
  socket.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ReconnectingSocket — liveness watchdog", () => {
  it("pings when the connection goes quiet", () => {
    socket.connect();
    latest().accept();

    // The watchdog only evaluates on its tick, so the first ping lands on the
    // first tick at or past the ping interval.
    vi.advanceTimersByTime(PING_INTERVAL_MS + WATCHDOG_TICK_MS);

    expect(pings(latest()).length).toBeGreaterThan(0);
  });

  it("does not ping while frames are arriving", () => {
    socket.connect();
    const ws = latest();
    ws.accept();

    // Steady inbound traffic well inside the ping interval.
    for (let i = 0; i < 4; i += 1) {
      vi.advanceTimersByTime(PING_INTERVAL_MS / 2);
      ws.deliver({ t: "event", event: { kind: "message.created" } });
    }

    expect(pings(ws)).toHaveLength(0);
  });

  it("detects a half-open socket and reconnects (D1 regression)", () => {
    socket.connect();
    const dead = latest();
    dead.accept();
    expect(MockWebSocket.instances).toHaveLength(1);

    // The socket stays OPEN and simply carries nothing — exactly what a NAT
    // rebind or cell handoff leaves behind. Without the watchdog this is
    // terminal: no close event is ever fired.
    vi.advanceTimersByTime(LIVENESS_TIMEOUT_MS + WATCHDOG_TICK_MS * 2);
    vi.advanceTimersByTime(5_000); // let the reconnect backoff elapse

    expect(MockWebSocket.instances.length).toBeGreaterThan(1);
    expect(dead.readyState).toBe(MockWebSocket.CLOSED);
  });

  it("tolerates a slow-but-alive link without reconnecting", () => {
    socket.connect();
    const ws = latest();
    ws.accept();

    // 2s of latency is nowhere near the liveness window; a watchdog that fired
    // here would put bad-but-usable connections into a reconnect loop.
    for (let i = 0; i < 6; i += 1) {
      vi.advanceTimersByTime(PING_INTERVAL_MS);
      vi.advanceTimersByTime(2_000);
      ws.deliver({ t: "pong" });
    }

    expect(MockWebSocket.instances).toHaveLength(1);
  });
});

describe("ReconnectingSocket — wake triggers", () => {
  it("reconnects immediately when a backgrounded tab is refocused", () => {
    socket.connect();
    latest().accept();
    expect(MockWebSocket.instances).toHaveLength(1);

    // Background-tab throttling: wall clock advances but timers don't run, so
    // the watchdog never gets a tick to notice the silence.
    setVisibility("hidden");
    vi.setSystemTime(Date.now() + LIVENESS_TIMEOUT_MS + 60_000);

    setVisibility("visible");

    // No timer advance — refocus must act at once, not wait for a backoff.
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("does not reconnect on refocus when the connection is healthy", () => {
    socket.connect();
    latest().accept();

    setVisibility("hidden");
    vi.advanceTimersByTime(1_000);
    setVisibility("visible");

    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("reconnects immediately when the network comes back", () => {
    socket.connect();
    latest().accept();
    latest().serverClose(1006); // abrupt drop

    expect(MockWebSocket.instances).toHaveLength(1);

    window.dispatchEvent(new Event("online"));

    // Bypasses the pending backoff entirely.
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("reports closed as soon as the browser goes offline", () => {
    const seen: RealtimeStatus[] = [];
    socket.onStatus((s) => seen.push(s));
    socket.connect();
    latest().accept();
    seen.length = 0;

    window.dispatchEvent(new Event("offline"));

    expect(seen).toContain("closed");
  });
});

describe("ReconnectingSocket — close codes", () => {
  it("retries after a 4401, since the session may refresh", () => {
    socket.connect();
    latest().accept();
    latest().serverClose(4401);

    vi.advanceTimersByTime(UNAUTHORIZED_RETRY_MS - 1_000);
    expect(MockWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(2_000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("stays down permanently on a 4403", () => {
    const seen: RealtimeStatus[] = [];
    socket.onStatus((s) => seen.push(s));
    socket.connect();
    latest().accept();
    latest().serverClose(4403);

    vi.advanceTimersByTime(120_000);

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(seen).toContain("stopped");
  });

  it("restart() revives a terminally closed socket", () => {
    socket.connect();
    latest().accept();
    latest().serverClose(4403);
    expect(MockWebSocket.instances).toHaveLength(1);

    socket.restart();

    expect(MockWebSocket.instances).toHaveLength(2);
  });
});

describe("ReconnectingSocket — backoff", () => {
  it("uses full jitter and resets the window after a successful open", () => {
    socket.connect();
    latest().accept();
    latest().serverClose(1006);

    // First retry: cap = 1000ms, mocked jitter = 0.5 → 500ms.
    vi.advanceTimersByTime(400);
    expect(MockWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(MockWebSocket.instances).toHaveLength(2);

    // A successful open resets the attempt counter, so the next failure starts
    // from the same short window rather than continuing to grow.
    latest().accept();
    latest().serverClose(1006);
    vi.advanceTimersByTime(400);
    expect(MockWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(200);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it("grows the backoff window while retries keep failing", () => {
    socket.connect();
    latest().accept();
    latest().serverClose(1006);

    vi.advanceTimersByTime(600); // 500ms → attempt 2
    expect(MockWebSocket.instances).toHaveLength(2);

    latest().serverClose(1006); // failed again, cap now 2000ms → 1000ms
    vi.advanceTimersByTime(600);
    expect(MockWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(600);
    expect(MockWebSocket.instances).toHaveLength(3);
  });
});

describe("ReconnectingSocket — lifecycle hygiene", () => {
  it("ignores frames from a superseded socket", () => {
    const events: TestEvent[] = [];
    socket.onEvent((e) => events.push(e));
    socket.connect();

    const first = latest();
    first.accept();
    const orphanedHandler = first.onmessage!;

    first.serverClose(1006);
    vi.advanceTimersByTime(1_000);
    expect(MockWebSocket.instances).toHaveLength(2);

    // The replaced socket's handler must refuse to deliver even if it somehow
    // still fires — the identity guard, not just handler detachment.
    orphanedHandler({ data: JSON.stringify({ t: "event", event: { kind: "stale" } }) });

    expect(events).toHaveLength(0);
  });

  it("delivers events from the live socket", () => {
    const events: TestEvent[] = [];
    socket.onEvent((e) => events.push(e));
    socket.connect();
    latest().accept();

    latest().deliver({ t: "event", event: { kind: "message.created" } });
    latest().deliver({ t: "pong" }); // non-event frames must not be dispatched

    expect(events).toEqual([{ kind: "message.created" }]);
  });

  it("re-runs onOpened for every reconnect so subscriptions are re-asserted", () => {
    socket.connect();
    latest().accept();
    expect(socket.openedCount).toBe(1);

    latest().serverClose(1006);
    vi.advanceTimersByTime(1_000);
    latest().accept();

    expect(socket.openedCount).toBe(2);
  });

  it("releases timers and wake listeners on close()", () => {
    const removeWindow = vi.spyOn(window, "removeEventListener");
    const removeDocument = vi.spyOn(document, "removeEventListener");

    socket.connect();
    latest().accept();
    const countAtClose = MockWebSocket.instances.length;

    socket.close();

    expect(removeWindow).toHaveBeenCalledWith("online", expect.any(Function));
    expect(removeWindow).toHaveBeenCalledWith("offline", expect.any(Function));
    expect(removeDocument).toHaveBeenCalledWith("visibilitychange", expect.any(Function));

    // No watchdog tick, no pending reconnect, and wake events are inert — a leak
    // here would multiply across every reconnect for the life of the tab.
    vi.advanceTimersByTime(LIVENESS_TIMEOUT_MS * 3);
    window.dispatchEvent(new Event("online"));
    setVisibility("visible");

    expect(MockWebSocket.instances).toHaveLength(countAtClose);
  });
});
