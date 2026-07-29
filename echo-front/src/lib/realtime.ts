import { isPolicyClose } from "@server/infrastructure/realtime/protocol";
import type { ClientFrame, RealtimeEvent, ServerFrame } from "@server/infrastructure/realtime/protocol";
import { API_URL } from "@/config/env";

export type RealtimeStatus = "connecting" | "open" | "closed";

type EventListener = (event: RealtimeEvent) => void;
type StatusListener = (status: RealtimeStatus, reconnected: boolean) => void;

/**
 * One WebSocket connection to `/ws`, scoped to a single workspace.
 *
 * Responsibilities are deliberately narrow: keep a connection alive (auto
 * reconnect with backoff), re-assert the desired channel subscriptions on every
 * (re)open, and surface typed events + status. It does NOT interpret events or
 * touch any cache — gap detection, ordering, and catch-up live in the
 * reconciliation layer (`features/channels/realtime`), because the socket is
 * only an accelerator; the REST sequence is the source of truth.
 *
 * Cookie auth rides the upgrade automatically (same-site), so there's no token
 * to manage here. Writes are never sent over the socket.
 */
export class WorkspaceRealtime {
  private ws: WebSocket | null = null;
  private readonly desired = new Set<string>();
  private readonly eventListeners = new Set<EventListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private hasConnectedBefore = false;
  private stopped = false;

  constructor(private readonly workspaceId: string) {}

  connect(): void {
    this.stopped = false;
    this.open();
  }

  private open(): void {
    // Detach + close any prior socket first so a superseded connection (React
    // StrictMode remount, flapping reconnect) can't deliver events twice. Each
    // handler also guards on socket identity.
    this.teardownSocket();

    const base = API_URL.replace(/^http/, "ws"); // http→ws, https→wss
    const url = `${base}/ws?workspaceId=${encodeURIComponent(this.workspaceId)}`;
    this.emitStatus("connecting", false);

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return; // superseded
      const reconnected = this.hasConnectedBefore;
      this.hasConnectedBefore = true;
      this.reconnectAttempts = 0;
      // Re-assert every desired subscription (covers the reconnect case).
      if (this.desired.size > 0) this.sendFrame({ t: "subscribe", channelIds: [...this.desired] });
      this.emitStatus("open", reconnected);
    };

    ws.onmessage = (e) => {
      if (this.ws !== ws) return; // ignore frames from a stale socket
      let frame: ServerFrame;
      try {
        frame = JSON.parse(e.data as string);
      } catch {
        return;
      }
      if (frame.t === "event") {
        for (const listener of this.eventListeners) listener(frame.event);
      }
    };

    ws.onclose = (e) => {
      if (this.ws !== ws) return; // a socket we already replaced
      this.ws = null;
      this.emitStatus("closed", false);
      // 44xx is the server rejecting us (origin/session/membership). Retrying
      // can only reproduce it, so stay down until something remounts us.
      if (isPolicyClose(e.code)) this.stopped = true;
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

  subscribe(channelId: string): void {
    if (this.desired.has(channelId)) return;
    this.desired.add(channelId);
    this.sendFrame({ t: "subscribe", channelIds: [channelId] });
  }

  unsubscribe(channelId: string): void {
    if (!this.desired.delete(channelId)) return;
    this.sendFrame({ t: "unsubscribe", channelIds: [channelId] });
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  close(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.teardownSocket();
  }

  private sendFrame(frame: ClientFrame): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  private emitStatus(status: RealtimeStatus, reconnected: boolean): void {
    for (const listener of this.statusListeners) listener(status, reconnected);
  }
}
