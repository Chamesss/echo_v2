import { isPolicyClose, WS_CLOSE } from "@server/infrastructure/realtime/protocol";

export type RealtimeStatus = "connecting" | "open" | "closed" | "stopped";

type StatusListener = (status: RealtimeStatus, reconnected: boolean) => void;

/**
 * How often the watchdog wakes up. Shorter than `PING_INTERVAL_MS` so a dead
 * connection is noticed promptly after `LIVENESS_TIMEOUT_MS` elapses rather than
 * up to a full ping period later.
 */
export const WATCHDOG_TICK_MS = 10_000;

/**
 * How often we send an application-level `{t:"ping"}` while otherwise idle. Kept
 * under the server's 30s heartbeat so a healthy socket always has recent traffic.
 */
export const PING_INTERVAL_MS = 25_000;

/**
 * No inbound frame at all for this long → assume the connection is dead.
 *
 * Deliberately generous (2+ missed pings). A watchdog that fires too eagerly is
 * its own defect: it would tear down bad-but-usable connections and put the
 * client in a reconnect loop, which is worse than the stall it's meant to fix.
 */
export const LIVENESS_TIMEOUT_MS = 60_000;

/**
 * Retry delay after a 4401. Unlike the other policy closes this one is
 * recoverable — the session may refresh moments later — so we back off hard
 * rather than giving up for the rest of the session.
 */
export const UNAUTHORIZED_RETRY_MS = 30_000;

const MAX_BACKOFF_MS = 30_000;

/**
 * A WebSocket that keeps itself connected.
 *
 * Shared by `WorkspaceRealtime` (`/ws`) and `UserRealtime` (`/ws/user`), which
 * were previously line-for-line duplicates of this lifecycle. Subclasses supply
 * a URL and, optionally, work to redo on every (re)open.
 *
 * Beyond reconnect-with-backoff it owns two things the browser will not do for
 * you:
 *
 * 1. **Liveness.** The browser WebSocket API does not surface protocol-level
 *    ping/pong to JavaScript, so the server's heartbeat is invisible here: a
 *    half-open socket (NAT rebind, cell handoff, sleep/wake) stays `OPEN`
 *    forever, `onclose` never fires, and nothing reconnects or catches up. We
 *    therefore run an application-level heartbeat against the server's
 *    `{t:"ping"}` → `{t:"pong"}` handler and force a reconnect on silence.
 *
 * 2. **Wake triggers.** Timers are throttled hard in background tabs (~1/min in
 *    Chrome, worse after 5 minutes), so a pending backoff can be delayed far past
 *    its nominal delay. `visibilitychange` and `online` short-circuit that.
 *
 * Reconnects flow through the normal `onclose` → `scheduleReconnect` → `onopen`
 * path, so the `reconnected` flag on the status listener still drives the
 * existing catch-up in `useChannelStream`. Nothing downstream needs to change.
 */
export abstract class ReconnectingSocket<TClientFrame, TEvent> {
  private ws: WebSocket | null = null;
  private readonly eventListeners = new Set<(event: TEvent) => void>();
  private readonly statusListeners = new Set<StatusListener>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private hasConnectedBefore = false;
  private stopped = false;
  /** Timestamp of the last inbound frame — the liveness signal. */
  private lastFrameAt = 0;
  private wakeListenersAttached = false;

  /** The URL to connect to. Called fresh on every (re)open. */
  protected abstract buildUrl(): string;

  /** Runs after the socket opens, before `"open"` is emitted. */
  protected onOpened(): void {}

  connect(): void {
    this.stopped = false;
    this.attachWakeListeners();
    this.open();
  }

  /**
   * Reconnect after a terminal close — the manual escape hatch behind the
   * connection banner's "Reconnect" action.
   */
  restart(): void {
    this.stopped = false;
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();
    this.attachWakeListeners();
    this.open();
  }

  close(): void {
    this.stopped = true;
    this.clearReconnectTimer();
    this.stopWatchdog();
    this.detachWakeListeners();
    this.teardownSocket();
  }

  onEvent(listener: (event: TEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private open(): void {
    // Detach + close any prior socket first so a superseded connection (React
    // StrictMode remount, flapping reconnect) can't deliver events twice. Each
    // handler also guards on socket identity.
    this.teardownSocket();
    this.emitStatus("connecting", false);

    const ws = new WebSocket(this.buildUrl());
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return; // superseded
      const reconnected = this.hasConnectedBefore;
      this.hasConnectedBefore = true;
      this.reconnectAttempts = 0;
      this.markAlive();
      this.startWatchdog();
      this.onOpened();
      this.emitStatus("open", reconnected);
    };

    ws.onmessage = (e) => {
      if (this.ws !== ws) return; // ignore frames from a stale socket
      // ANY inbound frame proves the link is alive — not just `pong`. So a busy
      // channel never needs to ping, and `pong` needs no special handling here.
      this.markAlive();
      let frame: { t?: string; event?: TEvent };
      try {
        frame = JSON.parse(e.data as string);
      } catch {
        return;
      }
      if (frame.t === "event" && frame.event !== undefined) {
        for (const listener of this.eventListeners) listener(frame.event);
      }
    };

    ws.onclose = (e) => {
      if (this.ws !== ws) return; // a socket we already replaced
      this.ws = null;
      this.stopWatchdog();

      // 4401 is recoverable — the session may refresh — so retry on a long fixed
      // delay instead of giving up. 4400/4403 (malformed, bad origin, not a
      // member) can only reproduce themselves, so those stay terminal.
      if (e.code === WS_CLOSE.unauthorized) {
        this.emitStatus("closed", false);
        this.scheduleReconnect(UNAUTHORIZED_RETRY_MS);
        return;
      }
      if (isPolicyClose(e.code)) {
        this.stopped = true;
        this.emitStatus("stopped", false);
        return;
      }

      this.emitStatus("closed", false);
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      if (this.ws !== ws) return;
      ws.close();
    };
  }

  /** Detach handlers and close the current socket so it can't fire listeners. */
  private teardownSocket(): void {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.onmessage = ws.onclose = ws.onerror = null;
    if (ws.readyState === WebSocket.CONNECTING) {
      // Closing mid-handshake makes the browser log "WebSocket is closed before
      // the connection is established" — noisy on every StrictMode remount. Let
      // the handshake finish, then close; the identity guards above keep this
      // orphan from reaching any listener in the meantime.
      ws.onopen = () => ws.close();
      return;
    }
    ws.onopen = null;
    try {
      ws.close();
    } catch {
      // already closing/closed
    }
  }

  private scheduleReconnect(fixedDelay?: number): void {
    if (this.reconnectTimer) return;
    let delay: number;
    if (fixedDelay !== undefined) {
      delay = fixedDelay;
    } else {
      // Full jitter: pick uniformly from [0, cap] rather than cap + a small
      // fixed jitter. Spreads a simultaneous mass reconnect across the whole
      // window instead of bunching every client into the same instant.
      const cap = Math.min(1000 * 2 ** this.reconnectAttempts, MAX_BACKOFF_MS);
      delay = Math.random() * cap;
    }
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.open();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private markAlive(): void {
    this.lastFrameAt = Date.now();
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    this.watchdogTimer = setInterval(() => this.checkLiveness(), WATCHDOG_TICK_MS);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  /**
   * The half-open detector. Silence past the timeout means the socket is dead
   * even though the browser still reports it OPEN — force it closed so the
   * normal reconnect + catch-up path runs.
   */
  private checkLiveness(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - this.lastFrameAt > LIVENESS_TIMEOUT_MS) {
      // Keep the backoff progression: silence may mean the network is genuinely
      // down, and hammering it would not help.
      this.forceReconnect(false);
      return;
    }
    // Gate on inbound traffic, not on when we last pinged: any frame already
    // proves liveness, so a busy socket never pings at all. When it is quiet,
    // this retries every tick until either a frame arrives or the timeout above
    // trips — several chances to elicit a reply before we give up on the socket.
    if (now - this.lastFrameAt >= PING_INTERVAL_MS) {
      this.sendRaw({ t: "ping" });
    }
  }

  /**
   * Tear down and reconnect. `resetBackoff` is for genuine "conditions changed"
   * signals (network restored, tab refocused) where waiting out a backoff the
   * old conditions earned would be pointless.
   */
  private forceReconnect(resetBackoff: boolean): void {
    if (this.stopped) return;
    this.stopWatchdog();
    this.teardownSocket();
    this.emitStatus("closed", false);
    if (resetBackoff) {
      this.reconnectAttempts = 0;
      this.clearReconnectTimer();
      this.open();
      return;
    }
    this.scheduleReconnect();
  }

  // --- Wake triggers -------------------------------------------------------

  private readonly onVisibilityChange = (): void => {
    if (typeof document === "undefined" || document.visibilityState !== "visible") return;
    if (this.stopped) return;
    // The watchdog interval is itself throttled while hidden, so on refocus we
    // evaluate liveness immediately rather than waiting for its next tick. This
    // is what makes laptop-wake and long-backgrounded tabs recover at once.
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      if (Date.now() - this.lastFrameAt > LIVENESS_TIMEOUT_MS) this.forceReconnect(true);
      return;
    }
    if (!this.ws) this.forceReconnect(true);
  };

  private readonly onOnline = (): void => {
    if (this.stopped) return;
    // A real signal that conditions changed, so restarting the backoff is right.
    if (!this.ws) this.forceReconnect(true);
  };

  private readonly onOffline = (): void => {
    // Surface it immediately so the UI reflects reality; the socket itself will
    // error out on its own and take the normal reconnect path.
    if (!this.stopped) this.emitStatus("closed", false);
  };

  private attachWakeListeners(): void {
    if (this.wakeListenersAttached || typeof window === "undefined") return;
    this.wakeListenersAttached = true;
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  private detachWakeListeners(): void {
    if (!this.wakeListenersAttached || typeof window === "undefined") return;
    this.wakeListenersAttached = false;
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }

  // --- Sending -------------------------------------------------------------

  /** Send a typed frame; a no-op when the socket isn't OPEN. */
  protected sendFrame(frame: TClientFrame): void {
    this.sendRaw(frame);
  }

  private sendRaw(frame: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  private emitStatus(status: RealtimeStatus, reconnected: boolean): void {
    for (const listener of this.statusListeners) listener(status, reconnected);
  }
}
