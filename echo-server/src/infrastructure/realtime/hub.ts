import type { WebSocket } from "ws";
import { logger } from "../../shared/logger/logger.js";
import { backplane, type Backplane } from "./backplane.js";
import {
  isChannelEvent,
  userNotifyChannel,
  workspaceNotifyChannel,
  WS_CLOSE,
  type RealtimeEvent,
  type ServerFrame,
  type UserEvent,
  type UserServerFrame,
} from "./protocol.js";

/**
 * In-process registry of live sockets and their channel subscriptions, plus the
 * glue to the backplane.
 *
 * Delivery has ONE path: every NOTIFY — including this instance's own publishes,
 * via loopback — lands in `deliverLocal`. That's what avoids double-sending.
 *
 * Authorization is NOT done here; the connection handler checks membership before
 * calling `subscribe`. The hub stays pure plumbing.
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

    // Deliver first, THEN revoke: a well-behaved client is told why, and a
    // misbehaving one loses access regardless.
    if (event.kind === "member.removed") this.evict(workspaceId, event.userId);
    if (event.kind === "channel.member_removed") {
      this.revokeChannel(workspaceId, event.userId, event.channelId);
    }
  }

  /**
   * Drop one user's subscription to one channel — the narrower sibling of
   * `evict`, since they remain in the workspace.
   *
   * Without this the subscription outlives the membership that justified it:
   * `subscribe` authorizes once, so removal relied on the removed user's own
   * client unsubscribing — which a modified client won't do, and which fails
   * anyway if the event is dropped (NOTIFY is at-most-once).
   */
  private revokeChannel(workspaceId: string, userId: string, channelId: string): void {
    const entry = this.workspaces.get(workspaceId);
    if (!entry) return;
    const subs = entry.channelSubs.get(channelId);
    if (!subs || subs.size === 0) return;
    // Collect before mutating: `unsubscribe` edits the set being iterated.
    const doomed: WebSocket[] = [];
    for (const ws of subs) {
      if (this.contexts.get(ws)?.userId === userId) doomed.push(ws);
    }
    for (const ws of doomed) this.unsubscribe(ws, channelId);
    if (doomed.length > 0) {
      logger.info(
        { workspaceId, userId, channelId, sockets: doomed.length },
        "realtime: revoked channel subscriptions for a removed member",
      );
    }
  }

  /**
   * Close a departed member's workspace sockets.
   *
   * Authorization is otherwise only checked at the start of a socket's life, so a
   * removed member kept receiving already-joined channels until they reconnected.
   * The client navigating itself out is cosmetic — a modified one wouldn't.
   *
   * Runs from `deliverLocal`, i.e. off the backplane, so it fires on EVERY
   * instance holding one of that user's sockets, not just the one that served
   * the removal.
   */
  private evict(workspaceId: string, userId: string): void {
    const entry = this.workspaces.get(workspaceId);
    if (!entry) return;
    // Collect before closing: `remove()` mutates the set being iterated.
    const doomed: WebSocket[] = [];
    for (const ws of entry.sockets) {
      if (this.contexts.get(ws)?.userId === userId) doomed.push(ws);
    }
    for (const ws of doomed) {
      // Drop hub state first, so nothing further can be routed to this socket
      // while the close handshake completes.
      this.remove(ws);
      ws.close(WS_CLOSE.forbidden, "No longer a workspace member");
    }
    if (doomed.length > 0) {
      logger.info(
        { workspaceId, userId, sockets: doomed.length },
        "realtime: closed sockets for a removed member",
      );
    }
  }
}

/** Process-wide hub bound to the shared backplane. */
export const hub = new RealtimeHub(backplane);
