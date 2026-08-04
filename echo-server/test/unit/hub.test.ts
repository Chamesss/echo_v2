import type { WebSocket } from "ws";
import { describe, expect, it } from "vitest";
import type { Backplane } from "../../src/infrastructure/realtime/backplane.js";
import { RealtimeHub } from "../../src/infrastructure/realtime/hub.js";
import type {
  ChannelEvent,
  MessageWire,
  RealtimeEvent,
  UserEvent,
} from "../../src/infrastructure/realtime/protocol.js";

/**
 * Hub fan-out routing — pure plumbing, no DB. Verifies the rules that make live
 * awareness work:
 *   - channel events reach only that channel's subscribers;
 *   - workspace events (roster changes) reach EVERY socket in the workspace;
 *   - user events (unread/notifications) reach all of a user's awareness sockets
 *     and never their workspace sockets, other users, or across workspaces.
 */

/**
 * In-memory backplane keyed by NOTIFY-channel NAME (matching the real one), so a
 * publish loops straight back to local subscribers on the same channel.
 */
class LoopbackBackplane implements Backplane {
  private readonly handlers = new Map<string, Set<(e: unknown) => void>>();
  async publish(channel: string, event: unknown): Promise<void> {
    for (const h of this.handlers.get(channel) ?? []) h(event);
  }
  async publishMany(messages: ReadonlyArray<{ channel: string; event: unknown }>): Promise<void> {
    for (const m of messages) await this.publish(m.channel, m.event);
  }
  subscribe(channel: string, handler: (e: unknown) => void): () => void {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }
  async close(): Promise<void> {}
}

function fakeSocket() {
  const sent: string[] = [];
  const closes: Array<{ code: number; reason: string }> = [];
  const ws = {
    readyState: 1, // WebSocket.OPEN
    send(data: string, cb?: (err?: Error) => void) {
      sent.push(data);
      cb?.();
    },
    close(code: number, reason: string) {
      closes.push({ code, reason });
      ws.readyState = 3; // WebSocket.CLOSED
    },
  };
  return {
    ws: ws as unknown as WebSocket,
    closes,
    // The event payload of every "event" frame, loosely typed (works for both
    // workspace ServerFrames and user UserServerFrames — same `{t,event}` shape).
    events: (): unknown[] =>
      sent
        .map((s) => JSON.parse(s) as { t: string; event?: unknown })
        .filter((f) => f.t === "event")
        .map((f) => f.event),
  };
}

function message(channelId: string): MessageWire {
  return {
    id: "m1",
    channelId,
    authorId: "ua",
    body: "hi",
    clientId: "c1",
    seq: 1,
    updatedSeq: 1,
    version: 1,
    deleted: false,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: null,
  };
}

describe("RealtimeHub routing", () => {
  it("fans a workspace event out to every socket, even those in no channel", async () => {
    const hub = new RealtimeHub(new LoopbackBackplane());
    const a = fakeSocket();
    const b = fakeSocket();
    hub.add(a.ws, { userId: "ua", workspaceId: "w1" });
    hub.add(b.ws, { userId: "ub", workspaceId: "w1" });
    hub.subscribe(a.ws, "c1"); // a is in a channel; b is in none

    const event: RealtimeEvent = { kind: "member.removed", userId: "ux" };
    await hub.publish("w1", event);

    expect(a.events()).toContainEqual(event);
    expect(b.events()).toContainEqual(event);
  });

  it("closes a removed member's socket instead of leaving it subscribed", async () => {
    // Membership is checked at the handshake and channel access at `subscribe`,
    // and nothing re-checks afterwards — so without this the removed user's
    // socket stayed open and kept receiving the channels it had already joined
    // until they happened to reconnect. Navigating them away client-side isn't
    // enough: that's the victim's own browser choosing to comply.
    const hub = new RealtimeHub(new LoopbackBackplane());
    const removed = fakeSocket();
    const bystander = fakeSocket();
    hub.add(removed.ws, { userId: "ux", workspaceId: "w1" });
    hub.add(bystander.ws, { userId: "ua", workspaceId: "w1" });
    hub.subscribe(removed.ws, "c1");
    hub.subscribe(bystander.ws, "c1");

    await hub.publish("w1", { kind: "member.removed", userId: "ux" });

    expect(removed.closes).toEqual([
      { code: 4403, reason: "No longer a workspace member" },
    ]);
    expect(bystander.closes).toEqual([]);
  });

  it("still tells the removed member why, before hanging up", async () => {
    const hub = new RealtimeHub(new LoopbackBackplane());
    const removed = fakeSocket();
    hub.add(removed.ws, { userId: "ux", workspaceId: "w1" });

    const event: RealtimeEvent = { kind: "member.removed", userId: "ux" };
    await hub.publish("w1", event);

    // Delivery happens before eviction, so a well-behaved client can react.
    expect(removed.events()).toContainEqual(event);
    expect(removed.closes).toHaveLength(1);
  });

  it("stops routing to an evicted socket", async () => {
    const hub = new RealtimeHub(new LoopbackBackplane());
    const removed = fakeSocket();
    const bystander = fakeSocket();
    hub.add(removed.ws, { userId: "ux", workspaceId: "w1" });
    hub.add(bystander.ws, { userId: "ua", workspaceId: "w1" });
    hub.subscribe(removed.ws, "c1");
    hub.subscribe(bystander.ws, "c1");

    await hub.publish("w1", { kind: "member.removed", userId: "ux" });
    const afterEviction = removed.events().length;

    // The leak this fixes: messages in a channel they were already subscribed to.
    await hub.publish("w1", {
      kind: "message.created",
      channelId: "c1",
      updatedSeq: 1,
      message: message("c1"),
    });

    expect(removed.events()).toHaveLength(afterEviction);
    expect(bystander.events().length).toBeGreaterThan(0);
  });

  it("evicts every socket that user has open in the workspace", async () => {
    // Two tabs, one membership. Closing one and not the other would leave the
    // hole open.
    const hub = new RealtimeHub(new LoopbackBackplane());
    const tab1 = fakeSocket();
    const tab2 = fakeSocket();
    hub.add(tab1.ws, { userId: "ux", workspaceId: "w1" });
    hub.add(tab2.ws, { userId: "ux", workspaceId: "w1" });

    await hub.publish("w1", { kind: "member.removed", userId: "ux" });

    expect(tab1.closes).toHaveLength(1);
    expect(tab2.closes).toHaveLength(1);
  });

  it("leaves that user's sockets in OTHER workspaces alone", async () => {
    // Removal is scoped to one workspace; being kicked from one must not sign
    // you out of another you're still a member of.
    const hub = new RealtimeHub(new LoopbackBackplane());
    const inW1 = fakeSocket();
    const inW2 = fakeSocket();
    hub.add(inW1.ws, { userId: "ux", workspaceId: "w1" });
    hub.add(inW2.ws, { userId: "ux", workspaceId: "w2" });

    await hub.publish("w1", { kind: "member.removed", userId: "ux" });

    expect(inW1.closes).toHaveLength(1);
    expect(inW2.closes).toHaveLength(0);
  });

  it("does not touch the awareness socket, which is not workspace-scoped", async () => {
    // `/ws/user` carries cross-workspace unread + notifications and depends on
    // the SESSION, not on any one membership. Losing a workspace must not kill
    // notifications for every other workspace the user still belongs to.
    const hub = new RealtimeHub(new LoopbackBackplane());
    const workspaceSocket = fakeSocket();
    const awareness = fakeSocket();
    hub.add(workspaceSocket.ws, { userId: "ux", workspaceId: "w1" });
    hub.addUserSocket(awareness.ws, { userId: "ux" });

    await hub.publish("w1", { kind: "member.removed", userId: "ux" });

    expect(workspaceSocket.closes).toHaveLength(1);
    expect(awareness.closes).toHaveLength(0);
  });

  it("delivers a channel event only to that channel's subscribers", async () => {
    const hub = new RealtimeHub(new LoopbackBackplane());
    const a = fakeSocket();
    const b = fakeSocket();
    hub.add(a.ws, { userId: "ua", workspaceId: "w1" });
    hub.add(b.ws, { userId: "ub", workspaceId: "w1" });
    hub.subscribe(a.ws, "c1"); // only a subscribes

    const event: ChannelEvent = {
      kind: "message.created",
      channelId: "c1",
      updatedSeq: 1,
      message: message("c1"),
    };
    await hub.publish("w1", event);

    expect(a.events()).toContainEqual(event);
    expect(b.events()).toHaveLength(0);
  });

  it("never leaks events across workspaces", async () => {
    const hub = new RealtimeHub(new LoopbackBackplane());
    const inW1 = fakeSocket();
    const inW2 = fakeSocket();
    hub.add(inW1.ws, { userId: "ua", workspaceId: "w1" });
    hub.add(inW2.ws, { userId: "ub", workspaceId: "w2" });

    await hub.publish("w1", { kind: "member.removed", userId: "ux" });

    expect(inW1.events()).toHaveLength(1);
    expect(inW2.events()).toHaveLength(0);
  });

  it("delivers a user event to all of that user's awareness sockets only", async () => {
    const hub = new RealtimeHub(new LoopbackBackplane());
    // Two awareness sockets for the same user (e.g. two tabs), one for another.
    const tab1 = fakeSocket();
    const tab2 = fakeSocket();
    const otherUser = fakeSocket();
    hub.addUserSocket(tab1.ws, { userId: "ua" });
    hub.addUserSocket(tab2.ws, { userId: "ua" });
    hub.addUserSocket(otherUser.ws, { userId: "ub" });
    // A workspace socket for the SAME user must NOT receive user events.
    const wsSocket = fakeSocket();
    hub.add(wsSocket.ws, { userId: "ua", workspaceId: "w1" });

    const event: UserEvent = {
      kind: "unread.bump",
      workspaceId: "w1",
      channelId: "c9",
      channelType: "channel",
      updatedSeq: 5,
    };
    await hub.publishToUser("ua", event);

    expect(tab1.events()).toContainEqual(event);
    expect(tab2.events()).toContainEqual(event);
    expect(otherUser.events()).toHaveLength(0);
    expect(wsSocket.events()).toHaveLength(0);
  });

  it("stops delivering to an awareness socket after it is removed", async () => {
    const hub = new RealtimeHub(new LoopbackBackplane());
    const tab = fakeSocket();
    hub.addUserSocket(tab.ws, { userId: "ua" });
    hub.removeUserSocket(tab.ws);

    await hub.publishToUser("ua", {
      kind: "unread.bump",
      workspaceId: "w1",
      channelId: "c9",
      channelType: "dm",
      updatedSeq: 1,
    });

    expect(tab.events()).toHaveLength(0);
  });
});
