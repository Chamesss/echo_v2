import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { decodeFrame } from "../../src/infrastructure/realtime/frame.js";
import { closeServer, startRealtimeServer } from "../helpers/realtime-server.js";

/**
 * Recovery from connection loss, staged at the TCP layer.
 *
 * These exist because the failure that actually strands users can't be produced
 * from application code. `ws.close()` sends a close frame — the cooperative
 * shutdown every client already handles. What strands a client is the
 * UNcooperative case: NAT rebind, cell handoff, laptop sleep. The connection
 * stays established at both ends, nothing more is ever delivered, and no event
 * fires. A `ChaosProxy` sits between client and server so the link can be frozen,
 * dropped or slowed for real.
 *
 * The invariant under test throughout: however the link breaks, the client ends
 * up converged with the server — nothing lost, nothing duplicated, order intact.
 */

const session = vi.hoisted(() => ({ current: null as { user: { id: string } } | null }));

vi.mock("../../src/infrastructure/auth/auth.js", () => ({
  auth: { api: { getSession: async () => session.current } },
}));

const { attachRealtimeServer } = await import("../../src/infrastructure/realtime/server.js");
const { backplane } = await import("../../src/infrastructure/realtime/backplane.js");
const { pool } = await import("../../src/infrastructure/database/pool.js");
const { listMessages, sendMessage } = await import(
  "../../src/modules/channels/messages.service.js"
);
const { openOrCreateDm } = await import("../../src/modules/channels/dm.service.js");
const { addMember, createUser, createWorkspace, destroyWorkspace } = await import(
  "../factories.js"
);
const { ChaosProxy } = await import("../helpers/chaos-proxy.js");
const { WsTestClient, waitFor } = await import("../helpers/ws-client.js");

const ORIGIN = "http://localhost:3000"; // matches CORS_ORIGINS in vitest.config.ts

let server: Server;
// Derived from the factory, which is the only way to name this instance type
// here: `ChaosProxy` arrives via a destructured dynamic import, so it's a value
// binding with no type side, and its constructor is private anyway — both
// `ChaosProxy` and `InstanceType<typeof ChaosProxy>` fail for those two reasons.
let proxy: Awaited<ReturnType<typeof ChaosProxy.start>>;
let author: Awaited<ReturnType<typeof createUser>>;
let reader: Awaited<ReturnType<typeof createUser>>;
let ws: Awaited<ReturnType<typeof createWorkspace>>;
let channelId: string;
const clients: InstanceType<typeof WsTestClient>[] = [];

beforeAll(async () => {
  author = await createUser();
  reader = await createUser();
  ws = await createWorkspace(author.id);
  await addMember(ws.workspaceId, reader.id, "member");
  channelId = (await openOrCreateDm(ws.workspaceId, author.id, [reader.id])).id;

  const started = await startRealtimeServer(attachRealtimeServer);
  server = started.server;
  proxy = await ChaosProxy.start(started.port);

  session.current = { user: { id: reader.id } };
});

afterEach(() => {
  for (const c of clients.splice(0)) c.close();
  proxy.resume();
  proxy.delay(0);
});

afterAll(async () => {
  await proxy.close();
  await closeServer(server);
  if (ws) await destroyWorkspace(ws);
  await backplane.close();
  await pool.end();
});

/** A watchdog-equipped client wired through the proxy and subscribed. */
async function connectedClient() {
  const client = new WsTestClient({
    url: `ws://127.0.0.1:${proxy.port}/ws?workspaceId=${ws.workspaceId}`,
    origin: ORIGIN,
  });
  clients.push(client);
  client.connect();
  await waitFor(() => client.isOpen, { label: "socket open" });
  client.subscribe(channelId);
  await waitFor(() => client.frames.some((f) => f.t === "subscribed"), {
    label: "subscription confirmed",
  });
  return client;
}

const send = (body: string) =>
  sendMessage(ws.workspaceId, channelId, author.id, { clientId: randomUUID(), body });

/** Seqs the client saw over the socket, deduped and sorted. */
const seenSeqs = (client: InstanceType<typeof WsTestClient>): number[] =>
  [
    ...new Set(
      client
        .events()
        .filter((e) => e.kind === "message.created")
        .map((e) => (e.message as { seq: number }).seq),
    ),
  ].sort((a, b) => a - b);

const subscribeCount = (client: InstanceType<typeof WsTestClient>): number =>
  client.frames.filter((f) => f.t === "subscribed").length;

/**
 * Counters snapshotted before an outage.
 *
 * Assertions are written as deltas against these rather than absolute values:
 * a connection can legitimately open more than once before a test even starts
 * (a slow handshake, a retried connect), and an absolute `opens > 1` would then
 * be satisfied by that instead of by the recovery under test — passing without
 * ever exercising it.
 */
const snapshot = (client: InstanceType<typeof WsTestClient>) => ({
  opens: client.opens,
  trips: client.watchdogTrips,
  subscribes: subscribeCount(client),
  events: seenSeqs(client).length,
});

describe("half-open connection", () => {
  it("strands a client with no heartbeat — the bug the watchdog exists for", async () => {
    // The baseline, kept as executable documentation of WHY the watchdog is
    // there. A plain socket with no application-level heartbeat cannot notice
    // this: protocol ping/pong isn't surfaced to page JS, so the browser never
    // reports anything wrong. The socket stays OPEN, no close event fires, and
    // no reconnect or catch-up is ever triggered. It is stuck until the OS TCP
    // stack gives up, which can take many minutes or never happen at all.
    const naive = new WebSocket(
      `ws://127.0.0.1:${proxy.port}/ws?workspaceId=${ws.workspaceId}`,
      { headers: { origin: ORIGIN } },
    );
    const received: unknown[] = [];
    let closed = false;
    naive.on("message", (d) => received.push(JSON.parse(decodeFrame(d))));
    naive.on("close", () => {
      closed = true;
    });
    await waitFor(() => naive.readyState === WebSocket.OPEN, { label: "naive open" });
    naive.send(JSON.stringify({ t: "subscribe", channelIds: [channelId] }));
    await waitFor(() => received.some((f) => (f as { t: string }).t === "subscribed"), {
      label: "naive subscribed",
    });

    proxy.freeze();
    const countAtFreeze = received.length;
    await send("sent while stranded");
    await new Promise((r) => setTimeout(r, 4_000)); // > the watchdog's window

    expect(closed).toBe(false); // nothing ever told it
    expect(naive.readyState).toBe(WebSocket.OPEN); // still "connected"
    expect(received.length).toBe(countAtFreeze); // and receiving nothing

    naive.terminate();
  });

  it("is detected and recovered, though nothing closes the socket", async () => {
    const client = await connectedClient();
    const before = snapshot(client);

    // The link goes silent with both ends still believing it is up. Before the
    // watchdog existed this was terminal — no close event, no reconnect, no
    // catch-up, a permanently frozen UI.
    proxy.freeze();

    await waitFor(() => client.watchdogTrips > before.trips, {
      label: "watchdog to notice the silence",
    });

    proxy.resume();
    await waitFor(() => client.isOpen && client.opens > before.opens, {
      label: "reconnect",
    });
  });

  it("re-asserts its subscriptions after recovering", async () => {
    const client = await connectedClient();
    const before = snapshot(client);

    proxy.freeze();
    await waitFor(() => client.watchdogTrips > before.trips, { label: "watchdog trip" });
    proxy.resume();
    await waitFor(() => client.opens > before.opens && client.isOpen, {
      label: "reconnect",
    });

    // A reconnect that forgot its subscriptions would look alive while
    // delivering nothing — a subtler version of the same stall.
    await waitFor(() => subscribeCount(client) > before.subscribes, {
      label: "re-subscribe",
    });

    await send("after recovery");
    await waitFor(() => seenSeqs(client).length > before.events, {
      label: "event after reconnect",
    });
  });

  it("loses no messages sent during the outage", async () => {
    const client = await connectedClient();
    const before = snapshot(client);
    proxy.freeze();
    await waitFor(() => client.watchdogTrips > before.trips, { label: "watchdog trip" });

    // Sent while the client is stranded — the socket can't deliver these.
    const during = await Promise.all([send("gap 1"), send("gap 2"), send("gap 3")]);

    proxy.resume();
    await waitFor(() => client.isOpen && client.opens > before.opens, {
      label: "reconnect",
    });

    // The socket is only an accelerator; the REST sequence is the source of
    // truth, and this is the query the client's catch-up runs on reconnect.
    const caught = await listMessages(ws.workspaceId, channelId, reader.id, {
      since: 0,
      limit: 100,
    });
    const caughtSeqs = caught.map((m) => m.seq);
    for (const m of during) expect(caughtSeqs).toContain(m.seq);
  });
});

describe("abrupt drop", () => {
  it("reconnects without a close handshake", async () => {
    const client = await connectedClient();
    const before = snapshot(client);

    proxy.drop(); // sockets destroyed outright — no close frame

    await waitFor(() => client.opens > before.opens && client.isOpen, {
      label: "reconnect",
    });
  });

  it("delivers messages again once back", async () => {
    const client = await connectedClient();
    const before = snapshot(client);
    proxy.drop();
    await waitFor(() => client.opens > before.opens && client.isOpen, {
      label: "reconnect",
    });
    await waitFor(() => subscribeCount(client) > before.subscribes, {
      label: "re-subscribe",
    });

    await send("post-drop");
    await waitFor(() => seenSeqs(client).length > before.events, { label: "delivery" });
  });
});

describe("a flapping connection", () => {
  it("converges without duplicating anything", async () => {
    const client = await connectedClient();
    const before = snapshot(client);

    for (let i = 0; i < 3; i += 1) {
      const opensBefore = client.opens;
      proxy.drop();
      await waitFor(() => client.opens > opensBefore && client.isOpen, {
        label: `reconnect ${i + 1}`,
      });
    }

    const sent = await send("after flapping");
    await waitFor(() => seenSeqs(client).length > before.events, { label: "delivery" });

    const seqs = seenSeqs(client);
    // Deduped vs raw: a repeated delivery would show up as the two differing.
    const raw = client
      .events()
      .filter((e) => e.kind === "message.created")
      .map((e) => (e.message as { seq: number }).seq);
    expect(raw.filter((s) => s === sent.seq)).toHaveLength(1);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b)); // still ordered
  });

  it("leaves no sockets behind on the server", async () => {
    const client = await connectedClient();

    for (let i = 0; i < 3; i += 1) {
      const opensBefore = client.opens;
      proxy.drop();
      await waitFor(() => client.opens > opensBefore && client.isOpen, {
        label: `reconnect ${i + 1}`,
      });
    }

    client.close();
    // Each cycle must release its predecessor; a leak here would accumulate for
    // as long as the tab stays open.
    await waitFor(() => proxy.connectionCount === 0, {
      label: "server to release sockets",
    });
  });
});

describe("a slow but alive link", () => {
  it("does not trip the watchdog", async () => {
    // The guard against overcorrecting: a watchdog that fires on latency would
    // put bad-but-usable connections into a reconnect loop, which is worse than
    // the stall it exists to fix.
    const client = new WsTestClient({
      url: `ws://127.0.0.1:${proxy.port}/ws?workspaceId=${ws.workspaceId}`,
      origin: ORIGIN,
      pingIntervalMs: 100,
      livenessTimeoutMs: 2_000, // comfortably above the injected latency
      tickMs: 50,
    });
    clients.push(client);
    client.connect();
    await waitFor(() => client.isOpen, { label: "socket open" });

    proxy.delay(150);
    await new Promise((r) => setTimeout(r, 1_200));

    expect(client.watchdogTrips).toBe(0);
    expect(client.opens).toBe(1);
  });
});

describe("sends interrupted by a drop", () => {
  it("resolve to exactly one message when retried with the same clientId", async () => {
    // The client retries a failed send by replaying its `clientId`. If the first
    // attempt actually landed before the link died, the retry must return THAT
    // row rather than creating a second — otherwise every flaky send duplicates.
    const clientId = randomUUID();

    const first = await sendMessage(ws.workspaceId, channelId, author.id, {
      clientId,
      body: "interrupted",
    });
    proxy.drop();
    const retry = await sendMessage(ws.workspaceId, channelId, author.id, {
      clientId,
      body: "interrupted",
    });

    expect(retry.id).toBe(first.id);
    expect(retry.seq).toBe(first.seq); // no sequence burned on the replay

    const all = await listMessages(ws.workspaceId, channelId, reader.id, {
      since: 0,
      limit: 200,
    });
    expect(all.filter((m) => m.clientId === clientId)).toHaveLength(1);
  });

  it("keeps the sequence gapless across concurrent retries", async () => {
    const clientId = randomUUID();

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        sendMessage(ws.workspaceId, channelId, author.id, { clientId, body: "racing retry" }),
      ),
    );

    const ids = new Set(results.map((m) => m.id));
    expect(ids.size).toBe(1); // four attempts, one message
  });
});
