import pg from "pg";
import { env } from "../../config/env.js";
import { logger } from "../../shared/logger/logger.js";

/**
 * The single application-wide `pg.Pool`.
 *
 * Used by both `control/client.ts` and `tenant/client.ts` — the bridge tenancy
 * model has all schemas in one database, so one pool serves the whole app.
 * `withTenantSchema` rebinds the search_path per-transaction, not per-pool.
 *
 * Sized for a starter footprint; tune `max` based on observed `pg_stat_activity`
 * once load is real. The cluster's `max_connections` is the hard ceiling — all
 * app instances combined can't exceed it.
 */
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  /**
   * Bound the wait for a connection so a saturated pool fails instead of
   * queueing forever: without it, a burst that outruns `max` turns into requests
   * that never return, clients that retry, and a server that can't recover even
   * after the burst passes. A rejected request is recoverable; a hung one isn't.
   *
   * Sized for a SERVERLESS provider, not for a warm local database. Neon
   * suspends idle compute, and the first connection after that has to wait for
   * it to wake — seconds, not milliseconds. A tight bound here (5s was the first
   * attempt) turns every cold start into a burst of failed requests, which is a
   * worse failure than the one it prevents. Warm connects measure well under 1s,
   * so this only ever binds on a genuine stall.
   */
  connectionTimeoutMillis: 15_000,
  /**
   * `search_path` for the control schema, plus a ceiling on any single query so
   * one pathological statement can't hold a pool slot indefinitely.
   *
   * `statement_timeout` MUST be folded into this string rather than passed as a
   * top-level `pg.Pool` key. `pg` does send the top-level form as its own
   * startup parameter, but it does not survive to the session here — verified
   * against this database, where the top-level key leaves `SHOW
   * statement_timeout` at `0` (no limit) while this form reports `15s`. Passed
   * the other way it is a silent no-op: no error, no warning, just no timeout.
   *
   * Also covers time BLOCKED on a row lock, not just executing — hence
   * configurable. A `lock_timeout` wouldn't help; it would cancel waiters sooner.
   */
  options: `-c search_path=control,public -c statement_timeout=${env.DB_STATEMENT_TIMEOUT_MS}`,
});

/**
 * Idle clients can die without anyone asking them to — a serverless provider
 * suspending compute, a proxy reaping an idle session, a network blip. `pg.Pool`
 * reports that as an `error` event, and because `Pool` is an EventEmitter, an
 * unhandled `error` is an uncaught exception that takes the whole process down.
 *
 * Nothing needs to be done about it: the pool discards the dead client and the
 * next checkout opens a fresh one. It just has to be observed.
 */
pool.on("error", (err) => {
  logger.warn({ err: err.message }, "idle database client error (pool will recycle it)");
});
