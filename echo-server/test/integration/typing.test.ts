import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { decodeFrame } from "../../src/infrastructure/realtime/frame.js";
import { closeServer, startRealtimeServer } from "../helpers/realtime-server.js";

/**
 * The typing frame — the only thing a client pushes that isn't a subscription.
 *
 * What's under test is the authorization shortcut that makes it affordable:
 * the server trusts `SocketContext.channels` (populated by an authorized
 * `subscribe`) instead of re-querying membership, so an unsubscribed channel id
 * must be rejected without ever reaching the bus, and a flood must be capped.
 */

const session = vi.hoisted(() => ({ current: null as { user: { id: string } } | null }));

vi.mock("../../src/infrastructure/auth/auth.js", () => ({
  auth: {
    api: { getSession: async () => session.current },
  },
}));

const { attachRealtimeServer } = await import("../../src/infrastructure/realtime/server.js");
const { hub } = await import("../../src/infrastructure/realtime/hub.js");
const { backplane } = await import("../../src/infrastructure/realtime/backplane.js");
const { pool } = await import("../../src/infrastructure/database/pool.js");
const { openOrCreateDm } = await import("../../src/modules/channels/dm.service.js");
const { createUser, createWorkspace, destroyWorkspace, addMember } = await import(
  "../factories.js"
);

const ORIGIN = "http://localhost:3000"; // matches CORS_ORIGINS in vitest.config.ts

let server: Server;
let port: number;
let a: Awaited<ReturnType<typeof createUser>>;
let b: Awaited<ReturnType<typeof createUser>>;
let ws: Awaited<ReturnType<typeof createWorkspace>>;
let channelId: string;

beforeAll(async () => {
  a = await createUser();
  b = await createUser();
  ws = await createWorkspace(a.id);
  await addMember(ws.workspaceId, b.id, "member");
  channelId = (await openOrCreateDm(ws.workspaceId, a.id, [b.id])).id;

  ({ server, port } = await startRealtimeServer(attachRealtimeServer));
});

afterAll(async () => {
  await closeServer(server);
  if (ws) await destroyWorkspace(ws);
  await backplane.close();
  await pool.end();
});

afterEach(() => vi.restoreAllMocks());

/**
 * Open a workspace socket, subscribe to `subscribeTo` (waiting for the server's
 * `subscribed` ack so the context is populated), then send every frame in
 * `then`. Resolves once they've been handled.
 */
async function withSocket(
  subscribeTo: string[],
  then: (send: (frame: unknown) => void) => Promise<void> | void,
): Promise<void> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?workspaceId=${ws.workspaceId}`, {
    headers: { origin: ORIGIN },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("socket timed out")), 10_000);
      socket.on("error", reject);
      socket.on("open", () => socket.send(JSON.stringify({ t: "subscribe", channelIds: subscribeTo })));
      socket.on("message", (data) => {
        const frame = JSON.parse(decodeFrame(data));
        if (frame.t === "subscribed") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    await then((frame) => socket.send(JSON.stringify(frame)));
    // Frames are handled in order, so one round-trip proves the typing frames
    // ahead of it have already been processed.
    await new Promise<void>((resolve) => {
      socket.on("message", (data) => {
        if (JSON.parse(decodeFrame(data)).t === "pong") resolve();
      });
      socket.send(JSON.stringify({ t: "ping" }));
    });
  } finally {
    socket.close();
  }
}

describe("typing frames", () => {
  it("rebroadcasts a typing frame for a channel the socket is subscribed to", async () => {
    session.current = { user: { id: a.id } };
    const publish = vi.spyOn(hub, "publish").mockResolvedValue();

    await withSocket([channelId], (send) => {
      send({ t: "typing", channelId, state: "start" });
    });

    expect(publish).toHaveBeenCalledWith(ws.workspaceId, {
      kind: "typing",
      channelId,
      userId: a.id,
      state: "start",
    });
  });

  it("drops a typing frame for a channel the socket never subscribed to", async () => {
    // The authorization shortcut: `ctx.channels` is the ONLY gate, so a channel
    // the socket didn't subscribe to must not reach the bus — even though this
    // user is genuinely a member of it.
    session.current = { user: { id: a.id } };
    const publish = vi.spyOn(hub, "publish").mockResolvedValue();

    await withSocket([], (send) => {
      send({ t: "typing", channelId, state: "start" });
    });

    expect(publish).not.toHaveBeenCalled();
  });

  it("caps a flood at the per-socket quota", async () => {
    session.current = { user: { id: a.id } };
    const publish = vi.spyOn(hub, "publish").mockResolvedValue();

    await withSocket([channelId], (send) => {
      // A legitimate client sends one per 3s; 20 at once is abuse.
      for (let i = 0; i < 20; i += 1) {
        send({ t: "typing", channelId, state: "start" });
      }
    });

    // TYPING_MAX_PER_WINDOW is 6 — the rest are dropped before they can each
    // become a `pg_notify` round-trip.
    expect(publish.mock.calls.length).toBeGreaterThan(0);
    expect(publish.mock.calls.length).toBeLessThanOrEqual(6);
  });
});
