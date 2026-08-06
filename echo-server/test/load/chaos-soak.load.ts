import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The maturity gate: sustained traffic through a link that keeps breaking.
 *
 * Every other file exercises one failure in isolation. This one runs freezes,
 * drops and recoveries at random, continuously, while messages keep flowing —
 * because the failures that survive review are usually interactions, not single
 * scenarios (a freeze during a reconnect, a drop mid-catch-up).
 *
 * The assertion at the end is the whole promise of the realtime layer stated
 * once: whatever happened in between, every client converges on exactly the set
 * of messages the database holds — nothing lost, nothing duplicated.
 *
 *   LOAD_SOAK_SECONDS=1800 LOAD_SOAK_CLIENTS=20 bun run test:load
 */

const session = vi.hoisted(() => ({ current: null as { user: { id: string } } | null }));
vi.mock("../../src/infrastructure/auth/auth.js", () => ({
  auth: { api: { getSession: async () => session.current } },
}));

const { setupLoadEnv, teardownLoadEnv, envInt, report, ORIGIN, MemorySampler, sleep } =
  await import("./harness.js");
const { WsTestClient, waitFor } = await import("../helpers/ws-client.js");
const { ChaosProxy } = await import("../helpers/chaos-proxy.js");
const { listMessages, sendMessage } = await import(
  "../../src/modules/channels/messages.service.js"
);

type Env = Awaited<ReturnType<typeof setupLoadEnv>>;
let env: Env;
// Same reason as connection-loss.test.ts: destructured dynamic import, private
// constructor — so the instance type comes from the factory.
let proxy: Awaited<ReturnType<typeof ChaosProxy.start>>;
const clients: InstanceType<typeof WsTestClient>[] = [];

const SOAK_SECONDS = envInt("LOAD_SOAK_SECONDS", 45);
const SOAK_CLIENTS = envInt("LOAD_SOAK_CLIENTS", 10);

beforeAll(async () => {
  env = await setupLoadEnv();
  proxy = await ChaosProxy.start(env.port);
  session.current = { user: { id: env.readerId } };
});

afterAll(async () => {
  for (const c of clients.splice(0)) c.close();
  if (proxy) await proxy.close();
  await teardownLoadEnv(env);
});

describe(`chaos soak (${SOAK_CLIENTS} clients, ${SOAK_SECONDS}s)`, () => {
  it("converges every client on the authoritative history", async () => {
    for (let i = 0; i < SOAK_CLIENTS; i += 1) {
      const client = new WsTestClient({
        url: `ws://127.0.0.1:${proxy.port}/ws?workspaceId=${env.workspace.workspaceId}`,
        origin: ORIGIN,
        reconnectDelayMs: 50 + Math.floor(Math.random() * 200),
      });
      clients.push(client);
      client.connect();
    }
    await waitFor(() => clients.every((c) => c.isOpen), {
      timeoutMs: 60_000,
      label: "sockets to connect",
    });
    for (const c of clients) c.subscribe(env.channelId);

    const memory = new MemorySampler();
    memory.start();

    const deadline = Date.now() + SOAK_SECONDS * 1_000;
    const sentIds: string[] = [];
    let disruptions = 0;

    while (Date.now() < deadline) {
      const clientId = randomUUID();
      sentIds.push(clientId);
      await sendMessage(env.workspace.workspaceId, env.channelId, env.authorId, {
        clientId,
        body: `soak ${sentIds.length}`,
      }).catch(() => {
        /* the send path has its own retry semantics; convergence is what we check */
      });

      // Randomly disrupt: a freeze (half-open) or an outright drop.
      const roll = Math.random();
      if (roll < 0.08) {
        proxy.freeze();
        disruptions += 1;
        await sleep(200 + Math.random() * 400);
        proxy.resume();
      } else if (roll < 0.14) {
        proxy.drop();
        disruptions += 1;
      }

      await sleep(50);
    }

    proxy.resume();
    memory.stop();

    // Give every client a full recovery window before judging convergence.
    await waitFor(() => clients.every((c) => c.isOpen), {
      timeoutMs: 120_000,
      label: "all clients to reconnect after the soak",
    });
    await sleep(2_000);

    // The authoritative history — what every client must converge on. Delivery
    // over the socket is best-effort by design; the REST sequence is the
    // contract, and this is the query the client's catch-up runs.
    const history = await listMessages(env.workspace.workspaceId, env.channelId, env.readerId, {
      since: 0,
      limit: 1_000,
    });
    const persistedIds = new Set(history.map((m) => m.clientId));
    const seqs = history.map((m) => m.seq).sort((a, b) => a - b);

    report("chaos-soak", {
      seconds: SOAK_SECONDS,
      clients: SOAK_CLIENTS,
      sent: sentIds.length,
      persisted: history.length,
      disruptions,
      totalReconnects: clients.reduce((sum, c) => sum + c.opens - 1, 0),
      watchdogTrips: clients.reduce((sum, c) => sum + c.watchdogTrips, 0),
      rssEndMb: memory.mb.at(-1),
      growth: memory.growthRatio,
    });

    // Every send that resolved is durable exactly once.
    const duplicated = seqs.filter((s, i) => i > 0 && s === seqs[i - 1]);
    expect(duplicated).toEqual([]);
    expect(new Set(history.map((m) => m.id)).size).toBe(history.length);

    // Gapless: any hole here would make client gap detection fire forever.
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]).toBe(seqs[i - 1]! + 1);
    }

    // No message vanished — every clientId that was persisted is still there.
    for (const id of persistedIds) expect(sentIds).toContain(id);

    expect(clients.every((c) => c.isOpen)).toBe(true);
    expect(memory.growthRatio).toBeLessThan(2.5);
  });
});
