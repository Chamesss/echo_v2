import pg from "pg";
import type { PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "echo-server/db/control-schema";
import { DATABASE_URL } from "./env.js";

/**
 * This server's own pool. Deliberately narrower than the app's: it is an
 * analytics sidecar, and it must never be able to starve the app of connections
 * or hold a lock long enough to matter.
 */
export const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: 4,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 15_000,
  // A hard ceiling on any single statement. An LLM will happily ask a question
  // whose query plan is terrible; this is what stops it hanging the client.
  options: "-c search_path=public -c statement_timeout=10000",
});

pool.on("error", (err) => {
  console.error("[echo-mcp] idle client error:", err.message);
});

export const controlDb = drizzle(pool, { schema });
export { schema };

// Identifiers cannot be bound as query parameters — only *values* can. Schema
// names therefore have to be interpolated, so validate their shape first. Same
// guard as infrastructure/database/tenant/client.ts.
const SAFE_SCHEMA_NAME = /^tenant_[a-z0-9_]+$/;

/**
 * Runs `fn` against one workspace's tenant schema inside a READ ONLY transaction.
 *
 * Three things are load-bearing here:
 *   - BEGIN READ ONLY makes "this tool cannot write" a guarantee enforced by
 *     Postgres, not a promise made by our code.
 *   - SET LOCAL scopes the search_path to this transaction, so the pinned path
 *     can't bleed into the next checkout of this connection.
 *   - We always ROLLBACK: there is nothing to commit, and it releases cleanly.
 */
export async function readTenant<T>(
  schemaName: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!SAFE_SCHEMA_NAME.test(schemaName)) {
    throw new Error(`Refusing to query unsafe schema name: ${schemaName}`);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL search_path TO "${schemaName}", public`);
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}
