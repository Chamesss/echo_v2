import pg from "pg";
import { env } from "../../config/env.js";
import { logger } from "../../shared/logger/logger.js";

/**
 * The single application-wide `pg.Pool`. All tenant schemas live in one database,
 * so one pool serves everything; `withTenantSchema` rebinds `search_path`
 * per-transaction, not per-pool.
 */
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  // Generous because Neon suspends idle compute: the first connect after a
  // sleep waits seconds. 5s turned every cold start into failed requests.
  connectionTimeoutMillis: 15_000,
  /**
   * `statement_timeout` MUST be folded into `options` rather than passed as a
   * top-level `pg.Pool` key — the top-level form is accepted but never reaches
   * the session (`SHOW statement_timeout` returns 0), a silent no-op.
   *
   * It also bounds time BLOCKED on a row lock, which is why it's configurable.
   * A `lock_timeout` wouldn't help: it would cancel waiters sooner.
   */
  options: `-c search_path=control,public -c statement_timeout=${env.DB_STATEMENT_TIMEOUT_MS}`,
});

/**
 * An idle client can die unasked (compute suspended, proxy reaping, network
 * blip). `Pool` is an EventEmitter, so an unhandled `error` would take the
 * process down — it only needs observing; the pool recycles the client itself.
 */
pool.on("error", (err) => {
  logger.warn({ err: err.message }, "idle database client error (pool will recycle it)");
});
