import pg from "pg";
import { env } from "../../config/env.js";
import { logger } from "../../shared/logger/logger.js";
import { pool } from "../database/pool.js";
import { type ChannelEvent, workspaceNotifyChannel } from "./protocol.js";

/**
 * Cross-instance fan-out for realtime events.
 *
 * A single Node process only sees the sockets it holds; with more than one
 * instance behind a load balancer, an event created on instance A must reach
 * subscribers on instance B. This is that backplane — an interface so the
 * transport can be swapped (e.g. Redis) without touching the hub.
 *
 * `PgNotifyBackplane` rides Postgres LISTEN/NOTIFY: zero new infrastructure, and
 * the seq + REST-catch-up safety net covers NOTIFY's at-most-once delivery (a
 * dropped notification just means a client briefly trails and reconciles on the
 * next event or reconnect).
 */
export interface Backplane {
  /** Broadcast an event to every instance subscribed to the workspace. */
  publish(workspaceId: string, event: ChannelEvent): Promise<void>;
  /** Receive events for a workspace; returns an unsubscribe handle. */
  subscribe(workspaceId: string, handler: (event: ChannelEvent) => void): () => void;
  close(): Promise<void>;
}

// pg_notify payloads are capped at 8000 bytes. Message bodies are length-limited
// at the API layer (see messages.dto) so a full event envelope stays well under
// this; we still guard so an oversized payload degrades to "skip the push"
// (clients catch up via REST) instead of throwing inside a request.
const MAX_PAYLOAD_BYTES = 7900;

// NOTIFY channel names are Postgres identifiers; workspace ids are UUIDs from
// our own DB, so this is belt-and-suspenders before quoting into LISTEN.
const SAFE_WORKSPACE_ID = /^[0-9a-f-]{36}$/i;

export class PgNotifyBackplane implements Backplane {
  private client: pg.Client | null = null;
  private connecting: Promise<void> | null = null;
  private closed = false;
  private readonly handlers = new Map<string, Set<(event: ChannelEvent) => void>>();

  /** Lazily (re)connect the dedicated LISTEN client and re-arm all channels. */
  private async ensureClient(): Promise<pg.Client> {
    if (this.client) return this.client;
    if (this.connecting) {
      await this.connecting;
      return this.client!;
    }
    this.connecting = (async () => {
      const client = new pg.Client({ connectionString: env.DATABASE_URL });
      client.on("notification", (msg) => this.onNotification(msg));
      client.on("error", (err) => this.onClientError(err));
      await client.connect();
      this.client = client;
      // Re-LISTEN every workspace we currently have subscribers for (covers the
      // reconnect case after a dropped connection).
      for (const workspaceId of this.handlers.keys()) {
        await this.listen(workspaceId);
      }
    })();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
    return this.client!;
  }

  private onClientError(err: Error): void {
    logger.error({ err: err.message }, "realtime backplane LISTEN client error; will reconnect");
    this.client = null;
    if (!this.closed && this.handlers.size > 0) {
      // Reconnect lazily; ensureClient re-LISTENs active workspaces.
      this.ensureClient().catch((e) =>
        logger.error({ err: (e as Error).message }, "realtime backplane reconnect failed"),
      );
    }
  }

  private onNotification(msg: pg.Notification): void {
    if (!msg.payload) return;
    let parsed: { workspaceId: string; event: ChannelEvent };
    try {
      parsed = JSON.parse(msg.payload);
    } catch {
      logger.warn({ channel: msg.channel }, "realtime backplane: unparseable notification payload");
      return;
    }
    const set = this.handlers.get(parsed.workspaceId);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(parsed.event);
      } catch (err) {
        logger.error({ err: (err as Error).message }, "realtime backplane handler threw");
      }
    }
  }

  private async listen(workspaceId: string): Promise<void> {
    if (!SAFE_WORKSPACE_ID.test(workspaceId)) {
      throw new Error(`Unsafe workspace id for LISTEN: ${workspaceId}`);
    }
    await this.client?.query(`LISTEN "${workspaceNotifyChannel(workspaceId)}"`);
  }

  async publish(workspaceId: string, event: ChannelEvent): Promise<void> {
    const payload = JSON.stringify({ workspaceId, event });
    if (Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) {
      logger.warn(
        { workspaceId, channelId: event.channelId, kind: event.kind },
        "realtime event exceeds NOTIFY payload limit; skipping push (clients will catch up)",
      );
      return;
    }
    // NOTIFY via the pool (parameterized through pg_notify) so publishing never
    // depends on the dedicated LISTEN client's connection state.
    await pool.query("SELECT pg_notify($1, $2)", [workspaceNotifyChannel(workspaceId), payload]);
  }

  subscribe(workspaceId: string, handler: (event: ChannelEvent) => void): () => void {
    let set = this.handlers.get(workspaceId);
    const isFirst = !set;
    if (!set) {
      set = new Set();
      this.handlers.set(workspaceId, set);
    }
    set.add(handler);

    if (isFirst) {
      // First subscriber for this workspace on this instance → start LISTENing.
      this.ensureClient()
        .then(() => this.listen(workspaceId))
        .catch((err) =>
          logger.error({ err: (err as Error).message, workspaceId }, "realtime LISTEN failed"),
        );
    }

    return () => {
      const current = this.handlers.get(workspaceId);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.handlers.delete(workspaceId);
        if (SAFE_WORKSPACE_ID.test(workspaceId)) {
          this.client
            ?.query(`UNLISTEN "${workspaceNotifyChannel(workspaceId)}"`)
            .catch(() => {});
        }
      }
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.handlers.clear();
    const client = this.client;
    this.client = null;
    if (client) await client.end().catch(() => {});
  }
}

/** Process-wide backplane instance. */
export const backplane: Backplane = new PgNotifyBackplane();
