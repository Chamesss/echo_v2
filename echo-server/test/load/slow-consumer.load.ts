import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import net from "node:net";

/**
 * Consumers that never read, while the channel stays busy.
 *
 * The server calls `ws.send()` and only logs on error — nothing anywhere checks
 * `bufferedAmount`. A peer that stops reading (a phone on a dying connection)
 * therefore accumulates an unbounded outbound buffer in the server's process.
 * We deliberately did NOT add backpressure handling at this size, so this file
 * is the evidence for that decision rather than a fix: it measures how much a
 * stalled reader actually costs and fails if that turns out to be unbounded in
 * practice at ~100 users.
 *
 * If this ever fails, backpressure handling stops being optional.
 *
 *   LOAD_SLOW_CLIENTS=25 LOAD_MESSAGES=300 bun run test:load
 */

const session = vi.hoisted(() => ({ current: null as { user: { id: string } } | null }));
vi.mock("../../src/infrastructure/auth/auth.js", () => ({
  auth: { api: { getSession: async () => session.current } },
}));

const { setupLoadEnv, teardownLoadEnv, envInt, report, MemorySampler, sleep } = await import(
  "./harness.js"
);
const { sendMessage } = await import("../../src/modules/channels/messages.service.js");

type Env = Awaited<ReturnType<typeof setupLoadEnv>>;
let env: Env;
const sockets: net.Socket[] = [];

// Sends here are sequential and each costs a full round-trip to the database,
// so the default is sized for a run that finishes in a couple of minutes. Raise
// MESSAGES well past this when you want the memory comparison to be meaningful
// rather than lost in RSS noise.
const SLOW_CLIENTS = envInt("LOAD_SLOW_CLIENTS", 10);
const MESSAGES = envInt("LOAD_MESSAGES", 40);

beforeAll(async () => {
  env = await setupLoadEnv();
  session.current = { user: { id: env.readerId } };
});

afterAll(async () => {
  for (const s of sockets.splice(0)) s.destroy();
  await teardownLoadEnv(env);
});

/**
 * A raw TCP socket that completes the WebSocket handshake, subscribes, and then
 * never reads again.
 *
 * Deliberately not the `ws` client: that library drains the socket for you, so
 * the kernel buffer keeps emptying and the server never experiences a stalled
 * reader. Pausing the raw socket is what actually applies the backpressure.
 */
async function stalledReader(port: number, workspaceId: string, channelId: string): Promise<net.Socket> {
  const socket = net.connect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  const key = Buffer.from(randomUUID().replace(/-/g, "").slice(0, 16)).toString("base64");
  socket.write(
    [
      `GET /ws?workspaceId=${workspaceId} HTTP/1.1`,
      "Host: 127.0.0.1",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
      "Origin: http://localhost:3000",
      "\r\n",
    ].join("\r\n"),
  );

  // Wait for the upgrade response, then subscribe, then stop reading entirely.
  await new Promise<void>((resolve) => {
    const onData = () => {
      socket.off("data", onData);
      resolve();
    };
    socket.on("data", onData);
    setTimeout(resolve, 2_000);
  });

  socket.write(encodeTextFrame(JSON.stringify({ t: "subscribe", channelIds: [channelId] })));
  socket.pause(); // from here on, nothing is read off the wire
  return socket;
}

/** Minimal client→server text frame (masked, as the protocol requires). */
function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const mask = Buffer.from([1, 2, 3, 4]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) masked[i] = payload[i]! ^ mask[i % 4]!;

  const header: number[] = [0x81]; // FIN + text opcode
  if (payload.length < 126) header.push(0x80 | payload.length);
  else header.push(0x80 | 126, (payload.length >> 8) & 0xff, payload.length & 0xff);

  return Buffer.concat([Buffer.from(header), mask, masked]);
}

/** Average wall time per send, over `count` sequential sends. */
async function measureSendMs(count: number, body: string): Promise<number> {
  const started = Date.now();
  for (let i = 0; i < count; i += 1) {
    await sendMessage(env.workspace.workspaceId, env.channelId, env.authorId, {
      clientId: randomUUID(),
      body,
    });
  }
  return (Date.now() - started) / count;
}

describe(`slow consumers (${SLOW_CLIENTS} stalled readers)`, () => {
  it("costs bounded memory and bounded throughput", async () => {
    // A body near the NOTIFY payload cap, so each broadcast is as large as the
    // protocol permits.
    const body = "x".repeat(3_500);

    // Baseline first, with nobody connected. Absolute timings here are mostly
    // database round-trip latency, which varies by machine and by how far away
    // the database is — so the assertion below is a RATIO against this, not a
    // fixed millisecond budget. That isolates the effect of the stalled readers
    // from the environment the test happens to run in.
    const baselineMs = await measureSendMs(Math.min(20, MESSAGES), body);

    const memory = new MemorySampler();
    memory.start(500);
    const baselineRss = process.memoryUsage().rss;

    for (let i = 0; i < SLOW_CLIENTS; i += 1) {
      sockets.push(await stalledReader(env.port, env.workspace.workspaceId, env.channelId));
    }
    await sleep(1_000);

    const stalledMs = await measureSendMs(MESSAGES, body);

    await sleep(2_000);
    memory.stop();
    const peak = Math.max(...memory.mb) * 1024 * 1024;
    const grewMb = Math.round((peak - baselineRss) / 1024 / 1024);
    const slowdown = stalledMs / Math.max(1, baselineMs);

    report("slow-consumer", {
      stalledReaders: SLOW_CLIENTS,
      messages: MESSAGES,
      bodyBytes: body.length,
      baselineMs,
      stalledMs,
      slowdown,
      baselineMb: Math.round(baselineRss / 1024 / 1024),
      peakMb: Math.round(peak / 1024 / 1024),
      grewMb,
      // For context: what RSS growth would look like if every broadcast were
      // buffered for every stalled reader and never released.
      worstCaseMb: (SLOW_CLIENTS * MESSAGES * body.length) / 1024 / 1024,
    });

    // Memory must stay bounded rather than tracking the volume broadcast at the
    // readers. Note this is an ABSOLUTE bound, not a comparison against the
    // theoretical "every message buffered for every reader" figure — at test
    // scale that figure is a fraction of a megabyte, well under RSS measurement
    // noise, so comparing against it would assert nothing. Raise the message
    // count and body size to make that comparison meaningful.
    expect(grewMb).toBeLessThan(256);

    // Memory is only half the risk, and probably the less important half: with
    // no backpressure, an undrained send queue also competes for the event loop
    // and drags down throughput for everyone else on the process. The damage
    // shows up as latency long before it shows up as an OOM. This ratio is what
    // says whether deferring backpressure handling is still defensible — if it
    // ever trips, it is not.
    expect(slowdown).toBeLessThan(4);
  });
});
