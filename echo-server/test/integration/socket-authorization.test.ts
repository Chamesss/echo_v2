import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

/**
 * Authorization on a socket that is ALREADY open.
 *
 * Membership is checked at the handshake and channel access at `subscribe`;
 * nothing re-checked afterwards. A member removed from a workspace therefore
 * kept a live, subscribed socket and went on receiving messages from channels
 * they had already joined until they happened to reconnect — which, for an idle
 * tab, could be never.
 *
 * The client does navigate itself out of the workspace when it sees
 * `member.removed` for itself, but that is a courtesy, not a control: it is the
 * removed user's own browser choosing to comply. These tests drive a raw socket
 * that does NOT comply, which is the only way to prove the server enforces it.
 */

const session = vi.hoisted(() => ({ current: null as { user: { id: string } } | null }));

vi.mock("../../src/infrastructure/auth/auth.js", () => ({
  auth: { api: { getSession: async () => session.current } },
}));

const { attachRealtimeServer } = await import("../../src/infrastructure/realtime/server.js");
const { backplane } = await import("../../src/infrastructure/realtime/backplane.js");
const { pool } = await import("../../src/infrastructure/database/pool.js");
const { sendMessage } = await import("../../src/modules/channels/messages.service.js");
const { openOrCreateDm } = await import("../../src/modules/channels/dm.service.js");
const { removeMember, leaveWorkspace } = await import(
  "../../src/modules/members/members.service.js"
);
const { removeChannelMember } = await import("../../src/modules/channels/channels.service.js");
const { addChannelMember } = await import("../../src/modules/channels/channels.service.js");
const { addMember, createUser, createWorkspace, destroyWorkspace, makeChannel } = await import(
  "../factories.js"
);
const { waitFor } = await import("../helpers/ws-client.js");

const ORIGIN = "http://localhost:3000"; // matches CORS_ORIGINS in vitest.config.ts

let server: Server;
let port: number;
let owner: Awaited<ReturnType<typeof createUser>>;
let ws: Awaited<ReturnType<typeof createWorkspace>>;

beforeAll(async () => {
  owner = await createUser();
  ws = await createWorkspace(owner.id);
  server = createServer();
  attachRealtimeServer(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(() => {
  // `server.close()` waits for every open connection, so one socket left behind
  // by a failing assertion hangs teardown for the whole file rather than just
  // failing that test.
  for (const c of openClients.splice(0)) c.socket.terminate();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (ws) await destroyWorkspace(ws);
  await backplane.close();
  await pool.end();
});

interface RawClient {
  socket: WebSocket;
  frames: Array<Record<string, unknown>>;
  closeCode: number | null;
  events: () => Array<Record<string, unknown>>;
}

/** Every client opened by a test, so teardown can't be blocked by a leak. */
const openClients: RawClient[] = [];

/**
 * A socket that ignores everything it is told and just keeps reading — the
 * uncooperative client the server has to defend against.
 */
async function rawClient(userId: string, channelId: string): Promise<RawClient> {
  session.current = { user: { id: userId } };
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?workspaceId=${ws.workspaceId}`, {
    headers: { origin: ORIGIN },
  });
  const client: RawClient = {
    socket,
    frames: [],
    closeCode: null,
    events: () =>
      client.frames
        .filter((f) => f.t === "event")
        .map((f) => f.event as Record<string, unknown>),
  };
  socket.on("message", (d) => client.frames.push(JSON.parse(d.toString())));
  socket.on("close", (code) => {
    client.closeCode = code;
  });
  socket.on("error", () => {
    /* surfaced via close */
  });
  openClients.push(client);

  await waitFor(() => socket.readyState === WebSocket.OPEN, {
    timeoutMs: 20_000,
    label: "socket open",
  });
  socket.send(JSON.stringify({ t: "subscribe", channelIds: [channelId] }));
  // `subscribe` re-checks channel access against the database, so this waits on
  // a real round-trip — generous, because a slow database shouldn't read as a
  // broken authorization path.
  await waitFor(() => client.frames.some((f) => f.t === "subscribed"), {
    timeoutMs: 20_000,
    label: "subscription confirmed",
  });
  return client;
}

/** A fresh workspace member with a DM they can subscribe to. */
async function memberWithChannel() {
  const user = await createUser();
  await addMember(ws.workspaceId, user.id, "member");
  const channel = await openOrCreateDm(ws.workspaceId, owner.id, [user.id]);
  return { user, channelId: channel.id };
}

/**
 * A fresh member of a private CHANNEL.
 *
 * Channel-level removal can't be exercised on a DM: a 1:1's participants are
 * fixed for its whole life, so `removeChannelMember` rejects it outright.
 */
async function memberOfPrivateChannel() {
  const user = await createUser();
  await addMember(ws.workspaceId, user.id, "member");
  const channel = await makeChannel(ws.workspaceId, owner.id, "private", `p-${randomUUID().slice(0, 8)}`);
  await addChannelMember(ws.workspaceId, channel.id, owner.id, user.id);
  return { user, channelId: channel.id };
}

describe("a member removed while their socket is open", () => {
  it("is disconnected with a policy code", async () => {
    const { user, channelId } = await memberWithChannel();
    const client = await rawClient(user.id, channelId);
    expect(client.socket.readyState).toBe(WebSocket.OPEN);

    await removeMember(ws.workspaceId, user.id);

    await waitFor(() => client.closeCode !== null, { timeoutMs: 20_000, label: "server to hang up" });
    // 4403 is a policy close: the client treats it as permanent and does not retry.
    expect(client.closeCode).toBe(4403);
  });

  it("is told why before being hung up on", async () => {
    const { user, channelId } = await memberWithChannel();
    const client = await rawClient(user.id, channelId);

    await removeMember(ws.workspaceId, user.id);
    await waitFor(() => client.closeCode !== null, { timeoutMs: 20_000, label: "server to hang up" });

    // Delivery precedes eviction so a cooperative client can react gracefully;
    // the disconnect happens either way.
    expect(client.events()).toContainEqual({ kind: "member.removed", userId: user.id });
  });

  it("receives no further messages from a channel it had already joined", async () => {
    // The actual leak: `subscribe` authorized this channel once, and nothing
    // revoked it. A socket that ignores the removal notice used to keep reading
    // the conversation indefinitely.
    const { user, channelId } = await memberWithChannel();
    const client = await rawClient(user.id, channelId);

    await sendMessage(ws.workspaceId, channelId, owner.id, {
      clientId: randomUUID(),
      body: "before removal",
    });
    await waitFor(() => client.events().some((e) => e.kind === "message.created"), {
      label: "pre-removal message",
    });

    await removeMember(ws.workspaceId, user.id);
    await waitFor(() => client.closeCode !== null, { timeoutMs: 20_000, label: "server to hang up" });
    const seenAtRemoval = client.events().filter((e) => e.kind === "message.created").length;

    await sendMessage(ws.workspaceId, channelId, owner.id, {
      clientId: randomUUID(),
      body: "after removal — must not reach them",
    });
    await new Promise((r) => setTimeout(r, 1_000));

    expect(client.events().filter((e) => e.kind === "message.created")).toHaveLength(
      seenAtRemoval,
    );
  });

  it("cannot get back in by reconnecting", async () => {
    const { user, channelId } = await memberWithChannel();
    const client = await rawClient(user.id, channelId);
    await removeMember(ws.workspaceId, user.id);
    await waitFor(() => client.closeCode !== null, { timeoutMs: 20_000, label: "server to hang up" });

    // The handshake check is the backstop behind the eviction.
    session.current = { user: { id: user.id } };
    const retry = new WebSocket(`ws://127.0.0.1:${port}/ws?workspaceId=${ws.workspaceId}`, {
      headers: { origin: ORIGIN },
    });
    const code = await new Promise<number>((resolve) => {
      retry.on("close", resolve);
      retry.on("error", () => resolve(-1));
    });

    expect(code).toBe(4403);
  });

  it("leaves other members connected", async () => {
    const staying = await memberWithChannel();
    const leaving = await memberWithChannel();
    const stayingClient = await rawClient(staying.user.id, staying.channelId);
    const leavingClient = await rawClient(leaving.user.id, leaving.channelId);

    await removeMember(ws.workspaceId, leaving.user.id);
    await waitFor(() => leavingClient.closeCode !== null, { timeoutMs: 20_000, label: "removed user hung up" });

    expect(stayingClient.closeCode).toBeNull();
    expect(stayingClient.socket.readyState).toBe(WebSocket.OPEN);
    stayingClient.socket.close();
  });
});

describe("a member removed from one channel", () => {
  it("stops receiving that channel's messages while staying connected", async () => {
    // Narrower than workspace removal: they're still in the workspace, so the
    // socket stays open — it just stops being a subscriber. Before this, the
    // subscription outlived the membership and the only thing that ended it was
    // the removed user's own client choosing to unsubscribe.
    const { user, channelId } = await memberOfPrivateChannel();
    const client = await rawClient(user.id, channelId);

    await sendMessage(ws.workspaceId, channelId, owner.id, {
      clientId: randomUUID(),
      body: "before removal",
    });
    await waitFor(() => client.events().some((e) => e.kind === "message.created"), {
      label: "pre-removal message",
    });
    const seenBefore = client.events().filter((e) => e.kind === "message.created").length;

    // Removed from the channel, but NOT from the workspace.
    await removeChannelMember(ws.workspaceId, channelId, { userId: owner.id, isWorkspaceAdmin: true }, user.id);
    await new Promise((r) => setTimeout(r, 1_000));

    await sendMessage(ws.workspaceId, channelId, owner.id, {
      clientId: randomUUID(),
      body: "after removal — must not reach them",
    });
    await new Promise((r) => setTimeout(r, 1_000));

    expect(client.events().filter((e) => e.kind === "message.created")).toHaveLength(seenBefore);
    // Still connected — this isn't an eviction.
    expect(client.closeCode).toBeNull();
    client.socket.close();
  });
});

describe("a member who leaves voluntarily", () => {
  it("is disconnected too", async () => {
    // `leaveWorkspace` is a separate code path from `removeMember`, but both
    // emit `member.removed` — so the one hub-level hook covers both.
    const { user, channelId } = await memberWithChannel();
    const client = await rawClient(user.id, channelId);

    await leaveWorkspace(ws.workspaceId, user.id);

    await waitFor(() => client.closeCode !== null, { timeoutMs: 20_000, label: "server to hang up" });
    expect(client.closeCode).toBe(4403);
  });
});
