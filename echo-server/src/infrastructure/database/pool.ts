import pg from "pg";
import { env } from "../../config/env.js";

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
  options: "-c search_path=control,public",
});
