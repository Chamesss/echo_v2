import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

/**
 * The realtime handshake.
 *
 * Authorization runs AFTER the upgrade completes (Bun's `ws` shim can't await
 * inside the `upgrade` event), so the contract under test is: every socket is
 * accepted, then either joins or is closed with a 44xx policy code — and frames
 * a client sends during that window are replayed once it joins, not dropped.
 */

// Hoisted so the module factory below can see it; each test sets the session
// the upgrade will resolve to.
const session = vi.hoisted(() => ({ current: null as { user: { id: string } } | null }));

vi.mock("../../src/infrastructure/auth/auth.js", () => ({
  auth: {
    api: {
      getSession: async () => {
        // Force the resolution to land a macrotask later, the way a real cookie
        // lookup does — this is exactly the window the buffering must survive.
        await new Promise((r) => setTimeout(r, 10));
        return session.current;
      },
    },
  },
}));

const { attachRealtimeServer } = await import("../../src/infrastructure/realtime/server.js");
const { backplane } = await import("../../src/infrastructure/realtime/backplane.js");
const { pool } = await import("../../src/infrastructure/database/pool.js");
const { createUser, createWorkspace, destroyWorkspace, addMember } = await import(
  "../factories.js"
);

const ORIGIN = "http://localhost:3000"; // matches CORS_ORIGINS in vitest.config.ts

let server: Server;
let port: number;
let user: Awaited<ReturnType<typeof createUser>>;
let stranger: Awaited<ReturnType<typeof createUser>>;
let ws: Awaited<ReturnType<typeof createWorkspace>>;

beforeAll(async () => {
  user = await createUser();
  stranger = await createUser();
  ws = await createWorkspace(user.id);
  await addMember(ws.workspaceId, user.id, "admin");

  server = createServer();
  attachRealtimeServer(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (ws) await destroyWorkspace(ws);
  await backplane.close();
  await pool.end();
});

/** Open a socket and resolve with what happened: joined, or closed with a code. */
function connect(
  path: string,
  opts: { origin?: string; sendOnOpen?: unknown } = {},
): Promise<{ opened: boolean; closeCode?: number; frames: unknown[] }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, {
      headers: { origin: opts.origin ?? ORIGIN },
    });
    const frames: unknown[] = [];
    let opened = false;

    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`timed out on ${path}`));
    }, 10_000);

    socket.on("open", () => {
      opened = true;
      // Sent immediately — i.e. while the server is still authorizing us.
      if (opts.sendOnOpen) socket.send(JSON.stringify(opts.sendOnOpen));
    });
    socket.on("message", (data) => {
      frames.push(JSON.parse(data.toString()));
      // We only ever expect one reply; close so the test doesn't wait it out.
      socket.close();
    });
    socket.on("close", (code) => {
      clearTimeout(timer);
      resolve({ opened, closeCode: code, frames });
    });
    socket.on("error", () => {
      /* surfaced via close */
    });
  });
}

describe("realtime handshake", () => {
  it("accepts the upgrade, then replays frames sent before auth resolved", async () => {
    session.current = { user: { id: user.id } };
    // The ping is sent on open, which happens ~10ms before auth resolves; a
    // pong proves it was buffered and replayed into the real handler.
    const result = await connect("/ws/user", { sendOnOpen: { t: "ping" } });

    expect(result.opened).toBe(true);
    expect(result.frames).toEqual([{ t: "pong" }]);
  });

  it("accepts the workspace socket for a member", async () => {
    session.current = { user: { id: user.id } };
    const result = await connect(`/ws?workspaceId=${ws.workspaceId}`, {
      sendOnOpen: { t: "ping" },
    });

    expect(result.opened).toBe(true);
    expect(result.frames).toEqual([{ t: "pong" }]);
  });

  it("closes an unauthenticated socket with 4401", async () => {
    session.current = null;
    const result = await connect("/ws/user");

    expect(result.opened).toBe(true); // the handshake itself always completes
    expect(result.closeCode).toBe(4401);
  });

  it("closes an untrusted origin with 4403", async () => {
    session.current = { user: { id: user.id } };
    const result = await connect("/ws/user", { origin: "http://evil.example" });

    expect(result.closeCode).toBe(4403);
  });

  it("closes a non-member's workspace socket with 4403", async () => {
    session.current = { user: { id: stranger.id } };
    const result = await connect(`/ws?workspaceId=${ws.workspaceId}`);

    expect(result.closeCode).toBe(4403);
  });

  it("closes a workspace socket with no workspaceId with 4400", async () => {
    session.current = { user: { id: user.id } };
    const result = await connect("/ws");

    expect(result.closeCode).toBe(4400);
  });
});
