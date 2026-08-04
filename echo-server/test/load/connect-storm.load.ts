import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Mass connect, then mass reconnect — the deploy/restart scenario.
 *
 * The failure this guards against isn't a slow reconnect, it's a system that
 * can't come back at all: every client drops at the same instant, every one of
 * them re-authenticates and re-subscribes at once, and each of those costs a DB
 * round-trip against a fixed pool. If the recovery work outruns capacity, the
 * retries pile on faster than they drain and the system stays down after the
 * original disruption has passed. The pass condition is therefore not latency —
 * it's that every client comes back WITHOUT intervention.
 *
 *   LOAD_CLIENTS=100 bun run test:load
 */

const session = vi.hoisted(() => ({ current: null as { user: { id: string } } | null }));
vi.mock("../../src/infrastructure/auth/auth.js", () => ({
  auth: { api: { getSession: async () => session.current } },
}));

const { setupLoadEnv, teardownLoadEnv, envInt, report, ORIGIN, MemorySampler, sleep } =
  await import("./harness.js");
const { WsTestClient, waitFor } = await import("../helpers/ws-client.js");

type Env = Awaited<ReturnType<typeof setupLoadEnv>>;
let env: Env;
const clients: InstanceType<typeof WsTestClient>[] = [];

const CLIENTS = envInt("LOAD_CLIENTS", 100);

beforeAll(async () => {
  env = await setupLoadEnv();
  session.current = { user: { id: env.readerId } };
});

afterAll(async () => {
  for (const c of clients.splice(0)) c.close();
  await teardownLoadEnv(env);
});

describe(`connect storm (${CLIENTS} clients)`, () => {
  it("connects every client, then recovers every one after a mass drop", async () => {
    const memory = new MemorySampler();
    memory.start();

    const connectStart = Date.now();
    for (let i = 0; i < CLIENTS; i += 1) {
      const client = new WsTestClient({
        url: env.wsUrl(),
        origin: ORIGIN,
        // Spread reconnects a little, as real clients do with jitter.
        reconnectDelayMs: 50 + Math.floor(Math.random() * 250),
      });
      clients.push(client);
      client.connect();
    }

    await waitFor(() => clients.every((c) => c.isOpen), {
      timeoutMs: 120_000,
      label: `${CLIENTS} sockets to connect`,
    });
    const connectMs = Date.now() - connectStart;

    for (const c of clients) c.subscribe(env.channelId);
    await waitFor(
      () => clients.every((c) => c.frames.some((f) => f.t === "subscribed")),
      { timeoutMs: 120_000, label: "all subscriptions confirmed" },
    );

    // The storm: drop everyone at once, the way a deploy or a restart does.
    const opensBefore = clients.map((c) => c.opens);
    const stormStart = Date.now();
    for (const c of clients) c.simulateDrop();

    await waitFor(() => clients.every((c, i) => c.isOpen && c.opens > opensBefore[i]!), {
      timeoutMs: 180_000,
      label: "every client to recover unattended",
    });
    const recoverMs = Date.now() - stormStart;

    // Recovery isn't just "connected" — a client that came back without its
    // subscriptions is still blind.
    await waitFor(
      () => clients.every((c) => c.frames.filter((f) => f.t === "subscribed").length >= 2),
      { timeoutMs: 120_000, label: "every client to re-subscribe" },
    );

    await sleep(1_000);
    memory.stop();

    report("connect-storm", {
      clients: CLIENTS,
      connectMs,
      recoverMs,
      reconnectsPerClient: clients[0]!.opens,
      rssMb: memory.mb.at(-1),
      growth: memory.growthRatio,
    });

    expect(clients.every((c) => c.isOpen)).toBe(true);
  });
});
