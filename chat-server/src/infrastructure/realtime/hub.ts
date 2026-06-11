import type { WebSocket } from "ws";
import { logger } from "../../shared/logger/logger.js";
import { backplane, type Backplane } from "./backplane.js";
import { type ChannelEvent, type ServerFrame } from "./protocol.js";

/**
 * In-process registry of live sockets and their channel subscriptions, plus the
 * glue to the cross-instance backplane.
 *
 * Each socket is workspace-scoped (set at the handshake) and subscribes to the
 * channels the user currently has open. The hub fans an event out to local
 * sockets subscribed to its channel; cross-instance delivery is handled by the
 * backplane: the first socket for a workspace makes this instance LISTEN, and
 * every NOTIFY for that workspace (including our own publishes — loopback) lands
 * in `deliverLocal`. That single path avoids double-sending.
 *
 * Authorization is NOT done here — the connection handler authorizes each
 * `subscribe` against channel membership before calling `subscribe()`. The hub
 * is pure plumbing so it stays trivially testable.
 */
export interface SocketContext {
  userId: string;
  workspaceId: string;
  channels: Set<string>;
}

interface WorkspaceEntry {
  sockets: Set<WebSocket>;
  /** channelId → sockets subscribed to it (within this workspace). */
  channelSubs: Map<string, Set<WebSocket>>;
  /** Backplane unsubscribe handle, freed when the last socket leaves. */
  unsubscribe: () => void;
}

export class RealtimeHub {
  private readonly contexts = new Map<WebSocket, SocketContext>();
  private readonly workspaces = new Map<string, WorkspaceEntry>();

  constructor(private readonly bus: Backplane) {}

  /** Register a freshly-authenticated socket (no channel subscriptions yet). */
  add(ws: WebSocket, ctx: { userId: string; workspaceId: string }): void {
    this.contexts.set(ws, { ...ctx, channels: new Set() });

    let entry = this.workspaces.get(ctx.workspaceId);
    if (!entry) {
      const channelSubs = new Map<string, Set<WebSocket>>();
      const unsubscribe = this.bus.subscribe(ctx.workspaceId, (event) =>
        this.deliverLocal(ctx.workspaceId, event),
      );
      entry = { sockets: new Set(), channelSubs, unsubscribe };
      this.workspaces.set(ctx.workspaceId, entry);
    }
    entry.sockets.add(ws);
  }

  /** Subscribe a socket to a channel (caller has already authorized access). */
  subscribe(ws: WebSocket, channelId: string): void {
    const ctx = this.contexts.get(ws);
    const entry = ctx && this.workspaces.get(ctx.workspaceId);
    if (!ctx || !entry) return;
    ctx.channels.add(channelId);
    let subs = entry.channelSubs.get(channelId);
    if (!subs) {
      subs = new Set();
      entry.channelSubs.set(channelId, subs);
    }
    subs.add(ws);
  }

  unsubscribe(ws: WebSocket, channelId: string): void {
    const ctx = this.contexts.get(ws);
    const entry = ctx && this.workspaces.get(ctx.workspaceId);
    if (!ctx || !entry) return;
    ctx.channels.delete(channelId);
    const subs = entry.channelSubs.get(channelId);
    if (subs) {
      subs.delete(ws);
      if (subs.size === 0) entry.channelSubs.delete(channelId);
    }
  }

  /** Tear down a socket on disconnect; releases the workspace LISTEN if it was the last. */
  remove(ws: WebSocket): void {
    const ctx = this.contexts.get(ws);
    this.contexts.delete(ws);
    if (!ctx) return;
    const entry = this.workspaces.get(ctx.workspaceId);
    if (!entry) return;
    for (const channelId of ctx.channels) {
      const subs = entry.channelSubs.get(channelId);
      if (subs) {
        subs.delete(ws);
        if (subs.size === 0) entry.channelSubs.delete(channelId);
      }
    }
    entry.sockets.delete(ws);
    if (entry.sockets.size === 0) {
      entry.unsubscribe();
      this.workspaces.delete(ctx.workspaceId);
    }
  }

  contextFor(ws: WebSocket): SocketContext | undefined {
    return this.contexts.get(ws);
  }

  /**
   * Publish an event for a workspace. Goes to the backplane; delivery to local
   * sockets happens via the LISTEN loopback (see `deliverLocal`). Called by the
   * message engine after a write commits.
   */
  async publish(workspaceId: string, event: ChannelEvent): Promise<void> {
    await this.bus.publish(workspaceId, event);
  }

  private deliverLocal(workspaceId: string, event: ChannelEvent): void {
    const entry = this.workspaces.get(workspaceId);
    if (!entry) return;
    const subs = entry.channelSubs.get(event.channelId);
    if (!subs || subs.size === 0) return;
    const frame: ServerFrame = { t: "event", event };
    const data = JSON.stringify(frame);
    for (const ws of subs) {
      // 1 === WebSocket.OPEN; avoid importing the value just for the enum.
      if (ws.readyState === 1) {
        ws.send(data, (err) => {
          if (err) logger.warn({ err: err.message }, "realtime: failed to send frame");
        });
      }
    }
  }
}

/** Process-wide hub bound to the shared backplane. */
export const hub = new RealtimeHub(backplane);
