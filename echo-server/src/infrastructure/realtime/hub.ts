import type { WebSocket } from "ws";
import { logger } from "../../shared/logger/logger.js";
import { backplane, type Backplane } from "./backplane.js";
import {
  isChannelEvent,
  userNotifyChannel,
  workspaceNotifyChannel,
  type RealtimeEvent,
  type ServerFrame,
  type UserEvent,
  type UserServerFrame,
} from "./protocol.js";

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

interface UserEntry {
  sockets: Set<WebSocket>;
  /** Backplane unsubscribe handle, freed when the user's last user-socket leaves. */
  unsubscribe: () => void;
}

export class RealtimeHub {
  private readonly contexts = new Map<WebSocket, SocketContext>();
  private readonly workspaces = new Map<string, WorkspaceEntry>();
  // The awareness layer: user-scoped sockets (one or more per user, across
  // whatever workspaces/dashboard they have open) that receive `UserEvent`s.
  private readonly userSockets = new Map<string, UserEntry>();
  private readonly userOf = new Map<WebSocket, string>();

  constructor(private readonly bus: Backplane) {}

  /** Register a freshly-authenticated workspace socket (no channel subscriptions yet). */
  add(ws: WebSocket, ctx: { userId: string; workspaceId: string }): void {
    this.contexts.set(ws, { ...ctx, channels: new Set() });

    let entry = this.workspaces.get(ctx.workspaceId);
    if (!entry) {
      const channelSubs = new Map<string, Set<WebSocket>>();
      const unsubscribe = this.bus.subscribe(
        workspaceNotifyChannel(ctx.workspaceId),
        (event) => this.deliverLocal(ctx.workspaceId, event as RealtimeEvent),
      );
      entry = { sockets: new Set(), channelSubs, unsubscribe };
      this.workspaces.set(ctx.workspaceId, entry);
    }
    entry.sockets.add(ws);
  }

  /** Register an awareness (user) socket — receives the user's `UserEvent`s only. */
  addUserSocket(ws: WebSocket, ctx: { userId: string }): boolean {
    this.userOf.set(ws, ctx.userId);
    let entry = this.userSockets.get(ctx.userId);
    const isFirst = !entry;
    if (!entry) {
      const unsubscribe = this.bus.subscribe(
        userNotifyChannel(ctx.userId),
        (event) => this.deliverUser(ctx.userId, event as UserEvent),
      );
      entry = { sockets: new Set(), unsubscribe };
      this.userSockets.set(ctx.userId, entry);
    }
    entry.sockets.add(ws);
    return isFirst;
  }

  /** Tear down an awareness socket; releases the user LISTEN if it was the last. */
  removeUserSocket(ws: WebSocket): boolean {
    const userId = this.userOf.get(ws);
    this.userOf.delete(ws);
    if (!userId) return false;
    const entry = this.userSockets.get(userId);
    if (!entry) return false;
    entry.sockets.delete(ws);
    if (entry.sockets.size === 0) {
      entry.unsubscribe();
      this.userSockets.delete(userId);
      return true;
    }
    return false;
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

  /** Does this user have a live awareness socket ON THIS INSTANCE? */
  isOnline(userId: string): boolean {
    return (this.userSockets.get(userId)?.sockets.size ?? 0) > 0;
  }

  /** Every user with a live awareness socket ON THIS INSTANCE. */
  onlineUserIds(): string[] {
    return [...this.userSockets.keys()];
  }

  async publishToWorkspaces(
    workspaceIds: readonly string[],
    event: RealtimeEvent,
  ): Promise<void> {
    if (workspaceIds.length === 0) return;
    await this.bus.publishMany(
      workspaceIds.map((id) => ({
        channel: workspaceNotifyChannel(id),
        event,
      })),
    );
  }

  contextFor(ws: WebSocket): SocketContext | undefined {
    return this.contexts.get(ws);
  }

  /**
   * Publish an event for a workspace. Goes to the backplane; delivery to local
   * sockets happens via the LISTEN loopback (see `deliverLocal`). Called by the
   * message engine after a write commits.
   */
  async publish(workspaceId: string, event: RealtimeEvent): Promise<void> {
    await this.bus.publish(workspaceNotifyChannel(workspaceId), event);
  }

  /** Publish a user-scoped awareness event (unread bump / notification). */
  async publishToUser(userId: string, event: UserEvent): Promise<void> {
    await this.bus.publish(userNotifyChannel(userId), event);
  }

  /**
   * Publish many user-scoped events in a single backplane round-trip — the
   * message fan-out path, where one message notifies every other member.
   */
  async publishToUsers(
    entries: ReadonlyArray<{ userId: string; event: UserEvent }>,
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.bus.publishMany(
      entries.map((e) => ({
        channel: userNotifyChannel(e.userId),
        event: e.event,
      })),
    );
  }

  private deliverUser(userId: string, event: UserEvent): void {
    const entry = this.userSockets.get(userId);
    if (!entry || entry.sockets.size === 0) return;
    const frame: UserServerFrame = { t: "event", event };
    const data = JSON.stringify(frame);
    for (const ws of entry.sockets) {
      if (ws.readyState === 1) {
        ws.send(data, (err) => {
          if (err)
            logger.warn(
              { err: err.message },
              "realtime: failed to send user frame",
            );
        });
      }
    }
  }

  private deliverLocal(workspaceId: string, event: RealtimeEvent): void {
    const entry = this.workspaces.get(workspaceId);
    if (!entry) return;
    // Channel events reach only that channel's subscribers; workspace events
    // (roster changes) aren't tied to a channel, so they fan out to every
    // socket connected to the workspace.
    const targets = isChannelEvent(event)
      ? entry.channelSubs.get(event.channelId)
      : entry.sockets;
    if (!targets || targets.size === 0) return;
    const frame: ServerFrame = { t: "event", event };
    const data = JSON.stringify(frame);
    for (const ws of targets) {
      // 1 === WebSocket.OPEN; avoid importing the value just for the enum.
      if (ws.readyState === 1) {
        ws.send(data, (err) => {
          if (err)
            logger.warn({ err: err.message }, "realtime: failed to send frame");
        });
      }
    }
  }
}

/** Process-wide hub bound to the shared backplane. */
export const hub = new RealtimeHub(backplane);
