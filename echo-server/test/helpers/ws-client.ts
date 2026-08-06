import { WebSocket } from "ws";
import { decodeFrame } from "../../src/infrastructure/realtime/frame.js";

/**
 * A Node-side client that behaves like the frontend's `ReconnectingSocket`:
 * application-level heartbeat, silence detection, reconnect with backoff, and
 * subscription re-assertion on every open.
 *
 * The frontend class can't be imported here (it targets the browser WebSocket
 * global), and the point of these tests isn't to re-verify its timer logic —
 * that's covered by unit tests with fake timers. What can only be verified
 * against the real server is that the recovery CONTRACT holds end to end: the
 * server answers the heartbeat, honours a re-subscribe after reconnect, and the
 * REST sequence still closes every gap the outage opened.
 *
 * Timings are constructor options so tests can run in milliseconds rather than
 * the production minute.
 */
export interface WsClientOptions {
  url: string;
  origin: string;
  /** Interval between application-level pings while idle. */
  pingIntervalMs?: number;
  /** Silence past this and the socket is treated as dead. */
  livenessTimeoutMs?: number;
  /** Fixed reconnect delay (tests don't need jitter). */
  reconnectDelayMs?: number;
  /** Watchdog evaluation interval. */
  tickMs?: number;
}

export class WsTestClient {
  private ws: WebSocket | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFrameAt = 0;
  private stopped = false;
  private readonly desired = new Set<string>();

  /** Every frame received, across all connections. */
  readonly frames: Array<Record<string, unknown>> = [];
  /** How many times a connection has opened (first connect = 1). */
  opens = 0;
  /** How many times the watchdog declared the link dead. */
  watchdogTrips = 0;

  private readonly pingIntervalMs: number;
  private readonly livenessTimeoutMs: number;
  private readonly reconnectDelayMs: number;
  private readonly tickMs: number;

  constructor(private readonly opts: WsClientOptions) {
    // The liveness window has to comfortably exceed the server's worst-case
    // response time, which here includes real DB round-trips on connect
    // (`authorize` reads memberships, `subscribe` re-checks channel access).
    // Too tight and the watchdog kills a connection that is merely slow — the
    // overcorrection these tests exist to rule out. Production's ratio is 60s
    // against ~100ms queries; this keeps the same generosity at test speed.
    this.pingIntervalMs = opts.pingIntervalMs ?? 300;
    this.livenessTimeoutMs = opts.livenessTimeoutMs ?? 3_000;
    this.reconnectDelayMs = opts.reconnectDelayMs ?? 50;
    this.tickMs = opts.tickMs ?? 50;
  }

  connect(): void {
    this.stopped = false;
    this.open();
  }

  private open(): void {
    const ws = new WebSocket(this.opts.url, { headers: { origin: this.opts.origin } });
    this.ws = ws;

    ws.on("open", () => {
      if (this.ws !== ws) return;
      this.opens += 1;
      this.lastFrameAt = Date.now();
      this.startWatchdog();
      if (this.desired.size > 0) {
        this.send({ t: "subscribe", channelIds: [...this.desired] });
      }
    });

    ws.on("message", (data) => {
      if (this.ws !== ws) return;
      this.lastFrameAt = Date.now(); // any frame proves liveness
      try {
        this.frames.push(JSON.parse(decodeFrame(data)));
      } catch {
        /* ignore malformed */
      }
    });

    ws.on("close", () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopWatchdog();
      if (!this.stopped) this.scheduleReconnect();
    });

    ws.on("error", () => {
      /* surfaced via close */
    });
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    this.watchdog = setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const idle = Date.now() - this.lastFrameAt;
      if (idle > this.livenessTimeoutMs) {
        // The half-open case: the socket still reports OPEN, so only this check
        // can free it. `terminate()` (not close()) because a close handshake
        // would need a reply the dead link can't deliver.
        this.watchdogTrips += 1;
        this.stopWatchdog();
        this.ws = null;
        ws.terminate();
        if (!this.stopped) this.scheduleReconnect();
        return;
      }
      if (idle >= this.pingIntervalMs) this.send({ t: "ping" }, ws);
    }, this.tickMs);
  }

  private stopWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.open();
    }, this.reconnectDelayMs);
  }

  private send(frame: unknown, target?: WebSocket): void {
    const ws = target ?? this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  }

  subscribe(channelId: string): void {
    this.desired.add(channelId);
    this.send({ t: "subscribe", channelIds: [channelId] });
  }

  /** Events received so far (unwrapped from their `{t:"event"}` envelope). */
  events(): Array<Record<string, unknown>> {
    return this.frames
      .filter((f) => f.t === "event")
      .map((f) => f.event as Record<string, unknown>);
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Kill the current connection but keep reconnecting — an abrupt drop from the
   * client's side, for tests that need many clients to fail at once without a
   * proxy in front of each.
   */
  simulateDrop(): void {
    const ws = this.ws;
    if (!ws) return;
    this.stopWatchdog();
    this.ws = null;
    ws.terminate();
    if (!this.stopped) this.scheduleReconnect();
  }

  close(): void {
    this.stopped = true;
    this.stopWatchdog();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.terminate();
    this.ws = null;
  }
}

/** Poll until `check` passes or the deadline expires. */
export async function waitFor(
  check: () => boolean,
  { timeoutMs = 5_000, label = "condition" } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}
