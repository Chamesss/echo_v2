import type { UserEvent, UserClientFrame, UserServerFrame } from "@server/infrastructure/realtime/protocol";
import { env } from "@/config/env";

export type UserRealtimeStatus = "connecting" | "open" | "closed";

type EventListener = (event: UserEvent) => void;
type StatusListener = (status: UserRealtimeStatus, reconnected: boolean) => void;

/**
 * The always-on **awareness** socket (`/ws/user`), scoped to the signed-in user
 * rather than a workspace. Sibling of `WorkspaceRealtime`, but deliberately
 * thinner: it has no channel subscriptions — it only keeps a connection alive
 * (auto-reconnect with backoff) and surfaces typed `UserEvent`s (unread bumps +
 * notifications) for *every* workspace the user belongs to.
 *
 * Mounted once under `RequireAuth` so it survives navigation (including to the
 * dashboard, which holds no workspace socket). As with the workspace socket,
 * it's only an accelerator — authoritative counts come from the REST summary, so
 * a missed event self-heals on the next load/reconnect (status listeners fire a
 * resync on reconnect).
 */
export class UserRealtime {
  private ws: WebSocket | null = null;
  private readonly eventListeners = new Set<EventListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private hasConnectedBefore = false;
  private stopped = false;

  connect(): void {
    this.stopped = false;
    this.open();
  }

  private open(): void {
    // Detach + close any prior socket first, so a superseded connection (e.g.
    // React 18 StrictMode's mount→unmount→mount, or a flapping reconnect) can
    // never deliver events twice. Every handler below also guards on identity.
    this.teardownSocket();

    const base = env.VITE_API_URL.replace(/^http/, "ws"); // http→ws, https→wss
    this.emitStatus("connecting", false);

    const ws = new WebSocket(`${base}/ws/user`);
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return; // superseded
      const reconnected = this.hasConnectedBefore;
      this.hasConnectedBefore = true;
      this.reconnectAttempts = 0;
      this.emitStatus("open", reconnected);
    };

    ws.onmessage = (e) => {
      if (this.ws !== ws) return; // ignore frames from a stale socket
      let frame: UserServerFrame;
      try {
        frame = JSON.parse(e.data as string);
      } catch {
        return;
      }
      if (frame.t === "event") {
        for (const listener of this.eventListeners) listener(frame.event);
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws) return; // a socket we already replaced
      this.ws = null;
      this.emitStatus("closed", false);
      if (!this.stopped) this.scheduleReconnect();
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
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close();
    } catch {
      // already closing/closed
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    // Exponential backoff with jitter, capped at 30s.
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    const jitter = Math.random() * 500;
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.open();
    }, delay + jitter);
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Heartbeat ping (server replies pong); keeps intermediaries from idling us out. */
  ping(): void {
    this.sendFrame({ t: "ping" });
  }

  close(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.teardownSocket();
  }

  private sendFrame(frame: UserClientFrame): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  private emitStatus(status: UserRealtimeStatus, reconnected: boolean): void {
    for (const listener of this.statusListeners) listener(status, reconnected);
  }
}
