import type { Server } from "node:http";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { and, eq } from "drizzle-orm";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth/auth.js";
import { controlDb } from "../database/control/client.js";
import { memberships } from "../database/control/schema.js";
import { corsOrigins } from "../../config/env.js";
import { logger } from "../../shared/logger/logger.js";
import { assertChannelAccess } from "../../modules/channels/channels.service.js";
import { hub } from "./hub.js";
import type { ClientFrame, ServerFrame } from "./protocol.js";

/**
 * Attaches the realtime WebSocket server at `/ws`.
 *
 * The handshake is the security boundary (HTTP CORS does NOT cover WebSockets —
 * a cross-origin page can open a socket with the cookie attached). Every upgrade
 * must pass three checks before we accept it:
 *   1. Origin ∈ trusted origins        — blocks cross-site WebSocket hijacking
 *   2. a valid Better Auth session     — same `getSession` the REST layer uses
 *   3. membership of `?workspaceId=`    — the socket is scoped to one workspace
 *
 * After that the socket subscribes to channels (each re-checked for channel
 * membership) and receives events. Writes never come over the socket — they go
 * through REST, which owns durability + the gapless sequence.
 */
const HEARTBEAT_MS = 30_000;

export function attachRealtimeServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const alive = new WeakMap<WebSocket, boolean>();

  httpServer.on("upgrade", (req, socket, head) => {
    // Only claim our own path; let other upgrade listeners (if any) handle theirs.
    const url = new URL(req.url ?? "", "http://localhost");
    if (url.pathname !== "/ws") return;

    handleUpgrade(req, socket, head, url, wss).catch((err) => {
      logger.warn({ err: (err as Error).message }, "ws upgrade failed");
      rejectUpgrade(socket, 500, "Internal Server Error");
    });
  });

  wss.on("connection", (ws: WebSocket, ctx: { userId: string; workspaceId: string }) => {
    hub.add(ws, ctx);
    alive.set(ws, true);

    ws.on("pong", () => alive.set(ws, true));
    ws.on("message", (data) => void onMessage(ws, ctx, data.toString()));
    ws.on("close", () => hub.remove(ws));
    ws.on("error", () => hub.remove(ws));
  });

  // Heartbeat: ping every client each interval; a client that missed the last
  // ping (never ponged) is dead — terminate it so the hub frees its slot.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  wss.on("close", () => clearInterval(heartbeat));

  logger.info("WebSocket server attached at /ws");
  return wss;
}

async function handleUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  url: URL,
  wss: WebSocketServer,
): Promise<void> {
  // 1. Origin allow-list (WS is not protected by CORS).
  const origin = req.headers.origin;
  if (!origin || !corsOrigins.includes(origin)) {
    return rejectUpgrade(socket, 403, "Forbidden Origin");
  }

  // 2. Authenticated session.
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
    query: { disableCookieCache: true },
  });
  if (!session?.user) return rejectUpgrade(socket, 401, "Unauthorized");

  // 3. Workspace membership (socket is workspace-scoped).
  const workspaceId = url.searchParams.get("workspaceId");
  if (!workspaceId) return rejectUpgrade(socket, 400, "Missing workspaceId");

  const [member] = await controlDb
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.userId, session.user.id), eq(memberships.workspaceId, workspaceId)))
    .limit(1);
  if (!member) return rejectUpgrade(socket, 403, "Not a workspace member");

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, { userId: session.user.id, workspaceId });
  });
}

async function onMessage(
  ws: WebSocket,
  ctx: { userId: string; workspaceId: string },
  raw: string,
): Promise<void> {
  let frame: ClientFrame;
  try {
    frame = JSON.parse(raw);
  } catch {
    return send(ws, { t: "error", message: "Invalid frame" });
  }

  switch (frame.t) {
    case "ping":
      return send(ws, { t: "pong" });

    case "unsubscribe":
      for (const channelId of frame.channelIds) hub.unsubscribe(ws, channelId);
      return;

    case "subscribe": {
      // Authorize each channel against channel membership before joining it.
      const granted: string[] = [];
      for (const channelId of frame.channelIds) {
        try {
          await assertChannelAccess(ctx.workspaceId, ctx.userId, channelId);
          hub.subscribe(ws, channelId);
          granted.push(channelId);
        } catch {
          // Silently skip channels the user can't access.
        }
      }
      return send(ws, { t: "subscribed", channelIds: granted });
    }

    default:
      return send(ws, { t: "error", message: "Unknown frame" });
  }
}

function send(ws: WebSocket, frame: ServerFrame): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(frame));
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}
