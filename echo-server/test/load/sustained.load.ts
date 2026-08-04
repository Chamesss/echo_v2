import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Steady state: N sockets, a constant message rate, for minutes.
 *
 * Latency percentiles are the visible output, but the pass condition that
 * matters is FLAT MEMORY. Every fix in this layer adds per-connection state —
 * a watchdog interval, wake listeners, a LISTEN registration, a dedupe set —
 * and anything that fails to release accumulates silently. A leak is invisible
 * in functional tests and only shows up in production days later, so a long run
 * with RSS sampling is the only thing that catches it.
 *
 *   LOAD_CLIENTS=100 LOAD_SECONDS=120 LOAD_RATE=10 bun run test:load
 */

const session = vi.hoisted(() => ({ current: null as { user: { id: string } } | null }));
vi.mock("../../src/infrastructure/auth/auth.js", () => ({
  auth: { api: { getSession: async () => session.current } },
}));

const { setupLoadEnv, teardownLoadEnv, envInt, percentile, report, ORIGIN, MemorySampler, sleep } =
  await import("./harness.js");
const { WsTestClient, waitFor } = await import("../helpers/ws-client.js");
const { sendMessage } = await import("../../src/modules/channels/messages.service.js");

type Env = Awaited<ReturnType<typeof setupLoadEnv>>;
let env: Env;
const clients: InstanceType<typeof WsTestClient>[] = [];

const CLIENTS = envInt("LOAD_CLIENTS", 50);
const SECONDS = envInt("LOAD_SECONDS", 30);
/**
 * Concurrent senders, each sending SEQUENTIALLY — one send, wait for it, pause,
 * repeat.
 *
 * Modelling offered load as a fixed messages-per-second firehose turned out to
 * be wrong in a way that mattered. Writers to one channel are serialized by a
 * row lock (`SELECT … FOR UPDATE` in `sendMessage`), held for the whole
 * transaction. Fire-and-forget sends therefore pile up as lock waiters, and
 * every waiter is holding a pool connection while it waits — so an offered rate
 * above the channel's write throughput doesn't just queue, it exhausts the pool
 * and starts failing unrelated work. Real users can't do that: each one waits
 * for their own message before sending another, which bounds in-flight writes to
 * the number of people actually typing.
 */
const SENDERS = envInt("LOAD_SENDERS", 5);
/** Pause between a sender's messages — 3s is brisk for a human. */
const SEND_INTERVAL_MS = envInt("LOAD_SEND_INTERVAL_MS", 3_000);

beforeAll(async () => {
  env = await setupLoadEnv();
  session.current = { user: { id: env.readerId } };
});

afterAll(async () => {
  for (const c of clients.splice(0)) c.close();
  await teardownLoadEnv(env);
});

describe(`sustained load (${CLIENTS} clients, ${SENDERS} senders, ${SECONDS}s)`, () => {
  it("holds latency and memory steady", async () => {
    for (let i = 0; i < CLIENTS; i += 1) {
      const client = new WsTestClient({ url: env.wsUrl(), origin: ORIGIN });
      clients.push(client);
      client.connect();
    }
    await waitFor(() => clients.every((c) => c.isOpen), {
      timeoutMs: 120_000,
      label: "sockets to connect",
    });
    for (const c of clients) c.subscribe(env.channelId);
    await waitFor(
      () => clients.every((c) => c.frames.some((f) => f.t === "subscribed")),
      { timeoutMs: 120_000, label: "subscriptions" },
    );

    // One observer measures delivery latency; having all N do it would mostly
    // measure the test process's own JSON parsing.
    const observer = clients[0]!;
    const sentAt = new Map<string, number>();
    const latencies: number[] = [];
    let accepted = 0;
    let rejected = 0;
    const errors = new Map<string, number>();

    /** Match whatever has arrived against what we sent, and time it. */
    const drain = (): void => {
      for (const event of observer.events()) {
        const key = (event.message as { clientId?: string } | undefined)?.clientId;
        if (key && sentAt.has(key)) {
          latencies.push(Date.now() - sentAt.get(key)!);
          sentAt.delete(key);
        }
      }
    };

    const memory = new MemorySampler();
    memory.start();

    const deadline = Date.now() + SECONDS * 1_000;
    const started = Date.now();
    let sentCount = 0;

    /** One simulated person: send, wait for the server, pause, repeat. */
    const sender = async (n: number): Promise<void> => {
      // Stagger starts so all senders don't contend on the same instant.
      await sleep((SEND_INTERVAL_MS / SENDERS) * n);
      while (Date.now() < deadline) {
        const clientId = randomUUID();
        sentAt.set(clientId, Date.now());
        sentCount += 1;
        try {
          await sendMessage(env.workspace.workspaceId, env.channelId, env.authorId, {
            clientId,
            body: `load ${sentCount}`,
          });
          accepted += 1;
        } catch (err) {
          // Swallowing these made an earlier version of this test pass while
          // the server was rejecting most of the load. Failures are the most
          // interesting result here, so they're counted and reported.
          rejected += 1;
          sentAt.delete(clientId);
          const kind = (err as Error).message.slice(0, 60);
          errors.set(kind, (errors.get(kind) ?? 0) + 1);
        }
        drain();
        await sleep(SEND_INTERVAL_MS);
      }
    };

    await Promise.all(Array.from({ length: SENDERS }, (_, n) => sender(n)));
    const elapsedSec = (Date.now() - started) / 1000;
    await sleep(2_000); // let the delivery tail arrive
    drain(); // ...and count it, which the first version forgot to do
    memory.stop();

    const deliveryRate = accepted === 0 ? 0 : latencies.length / accepted;

    report("sustained", {
      clients: CLIENTS,
      seconds: SECONDS,
      senders: SENDERS,
      achievedMsgPerSec: accepted / elapsedSec,
      sent: sentCount,
      accepted,
      rejected,
      deliveredToObserver: latencies.length,
      deliveryRate,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      rssStartMb: memory.mb[0],
      rssEndMb: memory.mb.at(-1),
      growth: memory.growthRatio,
      errors: [...errors.entries()].map(([k, n]) => `${n}×${k}`).join(" | ") || "none",
    });

    // Nobody dropped out under steady load.
    expect(clients.every((c) => c.isOpen)).toBe(true);
    // A trip on a healthy connection would mean we're tearing down working
    // sockets — the overcorrection the watchdog must not make.
    expect(clients.every((c) => c.watchdogTrips === 0)).toBe(true);
    // Memory may fluctuate with GC, but a steady climb is the shape of a leak.
    expect(memory.growthRatio).toBeLessThan(2);
    // The server must actually carry the offered load. Failing here means the
    // DB pool saturated — see `pool.ts`; `max` is the knob.
    expect(rejected).toBe(0);
    // And what it accepted must reach subscribers.
    expect(deliveryRate).toBeGreaterThan(0.95);
  });
});
