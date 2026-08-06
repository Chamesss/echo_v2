import pg from "pg";
import { env } from "../../config/env.js";
import { logger } from "../../shared/logger/logger.js";
import { pool } from "../database/pool.js";

/**
 * Cross-instance fan-out for realtime events.
 *
 * A single Node process only sees the sockets it holds; with more than one
 * instance behind a load balancer, an event created on instance A must reach
 * subscribers on instance B. This is that backplane — an interface so the
 * transport can be swapped (e.g. Redis) without touching the hub.
 *
 * It is keyed by an opaque NOTIFY-channel NAME (e.g. `rt_ws_<id>` for a
 * workspace, `rt_user_<id>` for a user's awareness stream). The hub builds those
 * names via `workspaceNotifyChannel` / `userNotifyChannel`; the backplane just
 * routes by string, so adding a new event scope is "pick a channel name."
 *
 * `PgNotifyBackplane` rides Postgres LISTEN/NOTIFY: zero new infrastructure, and
 * the seq + REST-catch-up safety net covers NOTIFY's at-most-once delivery (a
 * dropped notification just means a client briefly trails and reconciles on the
 * next event or reconnect).
 */
export interface Backplane {
  /** Broadcast an event to every instance subscribed to a NOTIFY channel. */
  publish(channel: string, event: unknown): Promise<void>;
  /**
   * Broadcast many (channel, event) pairs in a SINGLE round-trip. Used by the
   * message fan-out so notifying N recipients costs one DB call, not N.
   */
  publishMany(messages: ReadonlyArray<{ channel: string; event: unknown }>): Promise<void>;
  /** Receive events for a NOTIFY channel; returns an unsubscribe handle. */
  subscribe(channel: string, handler: (event: unknown) => void): () => void;
  /**
   * Whether RECEIVING works — for `/health/ready`. Publishing goes through the
   * pool and survives a dead LISTEN client; receiving doesn't, and local sockets
   * are fed through the same loopback. True with no subscriptions yet (the
   * client is lazy, so "no client" then means idle, not broken).
   */
  isDeliveryHealthy(): boolean;
  close(): Promise<void>;
}

// pg_notify payloads are capped at 8000 bytes. Message bodies are length-limited
// at the API layer (see messages.dto) so a full event stays well under this; we
// still guard so an oversized payload degrades to "skip the push" (clients catch
// up via REST) instead of throwing inside a request.
const MAX_PAYLOAD_BYTES = 7900;

// NOTIFY channel names are Postgres identifiers we quote into LISTEN/UNLISTEN
// (which can't be parameterized). Our names are `rt_ws_<uuid>` / `rt_user_<id>`;
// the user id is Better-Auth-generated and URL-safe. Validate before quoting —
// belt-and-suspenders against ever LISTENing an attacker-influenced string.
const SAFE_CHANNEL = /^rt_(ws|user)_[A-Za-z0-9_-]{1,64}$/;

export class PgNotifyBackplane implements Backplane {
  private client: pg.Client | null = null;
  private connecting: Promise<void> | null = null;
  private closed = false;
  private readonly handlers = new Map<string, Set<(event: unknown) => void>>();
  /** Tail of the LISTEN/UNLISTEN queue — see `runExclusive`. */
  private commandQueue: Promise<unknown> = Promise.resolve();

  /**
   * Runs a statement on the dedicated LISTEN client, one at a time.
   *
   * `pg.Client` (unlike the pool) holds a single connection: calling `.query()`
   * while another query is in flight is deprecated in pg 8 and removed in pg 9.
   * We hit that constantly because LISTEN and UNLISTEN are driven by socket
   * lifecycle, not by requests — a client disconnecting mid-subscribe fires
   * UNLISTEN straight into an in-flight LISTEN. Chaining every command off the
   * previous one's settlement keeps exactly one query on the wire.
   *
   * Failures don't poison the chain: the queue advances on rejection too, and
   * each caller sees only its own error.
   */
  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.commandQueue.then(fn, fn);
    this.commandQueue = result.catch(() => {});
    return result;
  }

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
      // Re-LISTEN every channel we currently have subscribers for (covers the
      // reconnect case after a dropped connection).
      for (const channel of this.handlers.keys()) {
        await this.listen(channel);
      }
    })();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
    return this.client!;
  }

  isDeliveryHealthy(): boolean {
    if (this.closed) return false;
    // Nothing subscribed yet → the lazy client hasn't been needed. Reporting
    // unhealthy here would fail readiness on every fresh boot.
    return this.handlers.size === 0 || this.client !== null;
  }

  private onClientError(err: Error): void {
    logger.error({ err: err.message }, "realtime backplane LISTEN client error; will reconnect");
    this.client = null;
    if (!this.closed && this.handlers.size > 0) {
      // Reconnect lazily; ensureClient re-LISTENs active channels.
      this.ensureClient().catch((e) =>
        logger.error({ err: (e as Error).message }, "realtime backplane reconnect failed"),
      );
    }
  }

  private onNotification(msg: pg.Notification): void {
    if (!msg.payload) return;
    // The NOTIFY channel name (msg.channel) tells us which subscribers to route
    // to; the payload is the event itself.
    const set = this.handlers.get(msg.channel);
    if (!set || set.size === 0) return;
    let event: unknown;
    try {
      event = JSON.parse(msg.payload);
    } catch {
      logger.warn({ channel: msg.channel }, "realtime backplane: unparseable notification payload");
      return;
    }
    for (const handler of set) {
      try {
        handler(event);
      } catch (err) {
        logger.error({ err: (err as Error).message }, "realtime backplane handler threw");
      }
    }
  }

  private async listen(channel: string): Promise<void> {
    if (!SAFE_CHANNEL.test(channel)) {
      throw new Error(`Unsafe NOTIFY channel for LISTEN: ${channel}`);
    }
    // Re-read `this.client` inside the queued callback: by the time our turn
    // comes the connection may have dropped and been replaced (or nulled by
    // `onClientError`), and LISTENing on the dead one would silently do nothing.
    await this.runExclusive(async () => {
      await this.client?.query(`LISTEN "${channel}"`);
    });
  }

  private async unlisten(channel: string): Promise<void> {
    if (!SAFE_CHANNEL.test(channel)) return;
    await this.runExclusive(async () => {
      await this.client?.query(`UNLISTEN "${channel}"`);
    });
  }

  async publish(channel: string, event: unknown): Promise<void> {
    const payload = JSON.stringify(event);
    if (Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) {
      logger.warn(
        { channel, kind: (event as { kind?: string }).kind },
        "realtime event exceeds NOTIFY payload limit; skipping push (clients will catch up)",
      );
      return;
    }
    // NOTIFY via the pool (parameterized through pg_notify) so publishing never
    // depends on the dedicated LISTEN client's connection state.
    await pool.query("SELECT pg_notify($1, $2)", [channel, payload]);
  }

  async publishMany(messages: ReadonlyArray<{ channel: string; event: unknown }>): Promise<void> {
    const channels: string[] = [];
    const payloads: string[] = [];
    for (const m of messages) {
      const payload = JSON.stringify(m.event);
      if (Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) {
        logger.warn(
          { channel: m.channel, kind: (m.event as { kind?: string }).kind },
          "realtime event exceeds NOTIFY payload limit; skipping push (clients will catch up)",
        );
        continue;
      }
      channels.push(m.channel);
      payloads.push(payload);
    }
    if (channels.length === 0) return;
    // One round-trip: fire every pg_notify from a single zipped statement.
    await pool.query(
      `SELECT pg_notify(c, p) FROM unnest($1::text[], $2::text[]) AS t(c, p)`,
      [channels, payloads],
    );
  }

  subscribe(channel: string, handler: (event: unknown) => void): () => void {
    let set = this.handlers.get(channel);
    const isFirst = !set;
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(handler);

    if (isFirst) {
      // First subscriber for this channel on this instance → start LISTENing.
      this.ensureClient()
        .then(() => this.listen(channel))
        .catch((err) =>
          logger.error({ err: (err as Error).message, channel }, "realtime LISTEN failed"),
        );
    }

    return () => {
      const current = this.handlers.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.handlers.delete(channel);
        this.unlisten(channel).catch(() => {});
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
