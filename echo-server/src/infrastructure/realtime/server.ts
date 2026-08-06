import type { Server } from "node:http";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { and, eq } from "drizzle-orm";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth/auth.js";
import { controlDb } from "../database/control/client.js";
import { memberships } from "../database/control/schema.js";
import { corsOrigins } from "../../config/env.js";
import { logger } from "../../shared/logger/logger.js";
import { assertChannelAccess } from "../../modules/channels/channels.gates.js";
import { decodeFrame } from "./frame.js";
import { hub } from "./hub.js";
import * as presence from "./presence.js";
import { WS_CLOSE } from "./protocol.js";
import type {
  ClientFrame,
  ServerFrame,
  UserClientFrame,
  UserServerFrame,
} from "./protocol.js";

/** What the authorize step hands to the `connection` event after auth passes. */
type ConnectionInfo =
  | { role: "workspace"; userId: string; workspaceId: string }
  | { role: "user"; userId: string };

/** Authorization outcome; on failure, the WS close code sent to the client. */
type AuthResult =
  | { ok: true; info: ConnectionInfo }
  | { ok: false; code: number; reason: string };

/**
 * Attaches the realtime WebSocket server at `/ws`.
 *
 * The handshake is the security boundary (HTTP CORS does NOT cover WebSockets —
 * a cross-origin page can open a socket with the cookie attached). Every socket
 * must pass three checks before it is registered with the hub:
 *   1. Origin ∈ trusted origins        — blocks cross-site WebSocket hijacking
 *   2. a valid Better Auth session     — same `getSession` the REST layer uses
 *   3. membership of `?workspaceId=`    — the socket is scoped to one workspace
 *
 * Those checks run AFTER the handshake completes, not before it. Bun's `ws` shim
 * requires the upgrade to finish synchronously inside the `upgrade` event — an
 * `await` first lets Bun recycle the socket, and the later upgrade throws
 * "upgrade requires a Request object". So we accept the socket, authorize it
 * while buffering whatever it sends, and close it with a 44xx policy code if it
 * fails. An unauthorized peer holds an inert socket for one auth round-trip: it
 * receives nothing and never reaches the hub.
 *
 * After that the socket subscribes to channels (each re-checked for channel
 * membership) and receives events. Writes never come over the socket — they go
 * through REST, which owns durability + the gapless sequence.
 */
const HEARTBEAT_MS = 30_000;

/** Frames a socket may send before auth resolves, past which it is hung up on. */
const PRE_AUTH_FRAME_LIMIT = 32;

/**
 * Bytes an unauthenticated socket may buffer before auth resolves. The frame
 * count alone isn't a bound — 32 frames can still be arbitrarily large — and
 * these arrive from a peer we haven't identified yet.
 */
const PRE_AUTH_BYTE_LIMIT = 64 * 1024;

/**
 * Largest inbound frame we'll accept. The `ws` default is 100 MB; nothing this
 * protocol accepts from a client comes close (the biggest is a `subscribe` with
 * a list of uuids), and message bodies go over REST, which has its own 1mb JSON
 * limit.
 */
const MAX_INBOUND_PAYLOAD_BYTES = 64 * 1024;

/**
 * Typing frames are the only thing a client pushes that isn't a subscription,
 * and every accepted one becomes a `pg_notify` round-trip. A well-behaved client
 * sends one per 3s (see `use-typing.ts`), so this is abuse protection rather than
 * fairness — a fixed window is plenty. Keyed by socket in a WeakMap so the quota
 * is collected with the connection.
 */
const TYPING_WINDOW_MS = 5_000;
const TYPING_MAX_PER_WINDOW = 6;
const typingQuota = new WeakMap<
  WebSocket,
  { windowStart: number; count: number }
>();

function allowTyping(ws: WebSocket): boolean {
  const now = Date.now();
  const quota = typingQuota.get(ws);
  if (!quota || now - quota.windowStart > TYPING_WINDOW_MS) {
    typingQuota.set(ws, { windowStart: now, count: 1 });
    return true;
  }
  if (quota.count >= TYPING_MAX_PER_WINDOW) return false;
  quota.count += 1;
  return true;
}

export function attachRealtimeServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_INBOUND_PAYLOAD_BYTES,
  });
  const alive = new WeakMap<WebSocket, boolean>();

  httpServer.on("upgrade", (req, socket, head) => {
    // Only claim our own paths; let other upgrade listeners (if any) handle theirs.
    // `/ws`       — workspace socket (channel/message reconciliation).
    // `/ws/user`  — awareness socket (cross-workspace unread + notifications).
    const url = new URL(req.url ?? "", "http://localhost");
    if (url.pathname !== "/ws" && url.pathname !== "/ws/user") return;

    // Synchronous by necessity — see the note on this function for why auth
    // cannot run before this call.
    wss.handleUpgrade(req, socket, head, (ws) => {
      // Heartbeat bookkeeping starts now, so a slow auth can't be mistaken for a
      // dead socket — and an auth that never settles still gets reaped.
      alive.set(ws, true);
      ws.on("pong", () => alive.set(ws, true));

      // The client sends `subscribe` the instant `onopen` fires, which is now
      // before we know who it is. Buffer those frames and replay them once the
      // real handlers are attached; dropping them would silently lose the
      // initial channel subscriptions until the next reconnect.
      const pending: string[] = [];
      let pendingBytes = 0;
      const bufferFrame = (data: unknown): void => {
        if (pending.length >= PRE_AUTH_FRAME_LIMIT) {
          ws.close(WS_CLOSE.badRequest, "Too many frames before auth");
          return;
        }
        const frame = String(data);
        pendingBytes += Buffer.byteLength(frame, "utf8");
        if (pendingBytes > PRE_AUTH_BYTE_LIMIT) {
          ws.close(WS_CLOSE.badRequest, "Too much data before auth");
          return;
        }
        pending.push(frame);
      };
      ws.on("message", bufferFrame);

      authorize(req, url)
        .then((result) => {
          ws.off("message", bufferFrame);
          if (ws.readyState !== ws.OPEN) return; // client gave up mid-auth
          if (!result.ok) {
            ws.close(result.code, result.reason);
            return;
          }
          // Synchronous: hub registration + the real `message` handler are in
          // place before the buffered frames are replayed below.
          wss.emit("connection", ws, result.info);
          for (const raw of pending) ws.emit("message", raw);
        })
        .catch((err) => {
          logger.warn({ err: (err as Error).message }, "ws auth failed");
          ws.off("message", bufferFrame);
          // 1011 is transient, so the client keeps its reconnect backoff.
          if (ws.readyState === ws.OPEN)
            ws.close(1011, "Internal Server Error");
        });
    });
  });

  wss.on("connection", (ws: WebSocket, info: ConnectionInfo) => {
    if (info.role === "user") {
      presence.onUserConnected(
        info.userId,
        hub.addUserSocket(ws, { userId: info.userId }),
      );
      ws.on("message", (data) => void onUserMessage(ws, decodeFrame(data)));

      const detach = () =>
        presence.onUserDisconnected(info.userId, hub.removeUserSocket(ws));

      ws.on("close", detach);
      ws.on("error", detach);
      return;
    }

    hub.add(ws, { userId: info.userId, workspaceId: info.workspaceId });
    ws.on("message", (data) => void onMessage(ws, info, decodeFrame(data)));
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

/**
 * Decides whether an already-upgraded socket may join, and as what. Pure: it
 * touches no socket, so the caller owns every close.
 */
async function authorize(req: IncomingMessage, url: URL): Promise<AuthResult> {
  // 1. Origin allow-list (WS is not protected by CORS).
  const origin = req.headers.origin;
  if (!origin || !corsOrigins.includes(origin)) {
    return { ok: false, code: WS_CLOSE.forbidden, reason: "Forbidden origin" };
  }

  // 2. Authenticated session.
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
    query: { disableCookieCache: true },
  });
  if (!session?.user)
    return { ok: false, code: WS_CLOSE.unauthorized, reason: "Unauthorized" };

  // 2b. The awareness socket is user-scoped, not workspace-scoped: a valid
  // session is enough (membership is enforced per-event when the server decides
  // who to notify). No workspaceId, no channel subscriptions.
  if (url.pathname === "/ws/user") {
    return { ok: true, info: { role: "user", userId: session.user.id } };
  }

  // 3. Workspace membership (the workspace socket is workspace-scoped).
  const workspaceId = url.searchParams.get("workspaceId");
  if (!workspaceId)
    return {
      ok: false,
      code: WS_CLOSE.badRequest,
      reason: "Missing workspaceId",
    };

  const [member] = await controlDb
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, session.user.id),
        eq(memberships.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!member)
    return {
      ok: false,
      code: WS_CLOSE.forbidden,
      reason: "Not a workspace member",
    };

  return {
    ok: true,
    info: { role: "workspace", userId: session.user.id, workspaceId },
  };
}

async function onUserMessage(ws: WebSocket, raw: string): Promise<void> {
  let frame: UserClientFrame;
  try {
    frame = JSON.parse(raw);
  } catch {
    return sendUser(ws, { t: "error", message: "Invalid frame" });
  }
  // The awareness socket carries no subscriptions; heartbeat is all it sends.
  if (frame.t === "ping") return sendUser(ws, { t: "pong" });
  return sendUser(ws, { t: "error", message: "Unknown frame" });
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

    case "typing": {
      // Authorization is already settled: `ctx.channels` only ever contains
      // channels this socket passed `assertChannelAccess` for in the `subscribe`
      // case above. So this is a Set.has() — re-running the DB check here would
      // put a query on every throttle tick, which is the whole reason typing
      // isn't a REST endpoint.
      const socketCtx = hub.contextFor(ws);
      if (!socketCtx || !socketCtx.channels.has(frame.channelId)) return;
      if (!allowTyping(ws)) return;
      // Ephemeral: published like any channel event (so it fans out to that
      // conversation's subscribers on every instance) but persisted nowhere and
      // consuming no sequence.
      await hub.publish(socketCtx.workspaceId, {
        kind: "typing",
        channelId: frame.channelId,
        userId: socketCtx.userId,
        state: frame.state,
      });
      return;
    }

    default:
      return send(ws, { t: "error", message: "Unknown frame" });
  }
}

function send(ws: WebSocket, frame: ServerFrame): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(frame));
}

function sendUser(ws: WebSocket, frame: UserServerFrame): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(frame));
}
