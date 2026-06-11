import type { PoolClient } from "pg";
import { eq } from "drizzle-orm";
import { pool } from "../pool.js";
import { controlDb } from "../control/client.js";
import { tenantCatalog } from "../control/schema.js";
import { NotFoundError } from "../../../shared/errors/app-error.js";
import { ErrorCode } from "../../../shared/errors/error-codes.js";

/**
 * Per-workspace data access for the schema-per-tenant ("bridge") model.
 *
 * Channels, messages, and read state live in each workspace's `tenant_<slug>`
 * Postgres schema (provisioned from `tenant/init.sql`). This module is the only
 * way the app should touch those tables: it resolves the workspace's schema
 * name from `control.tenant_catalog`, then runs the caller's work in a
 * transaction with `search_path` pinned to that schema — so unqualified table
 * names (`channels`, `messages`, …) resolve to the right tenant and never leak
 * across workspaces.
 *
 * Why a transaction every time: `SET LOCAL search_path` only lasts for the
 * current transaction, which is exactly the isolation we want on a shared
 * pool — the pinned path can't bleed into the next checkout of this connection.
 * It also gives the messaging engine the atomicity it needs (lock the channel
 * row → bump the seq → insert) for free.
 */

// schemaName never changes for a workspace, so cache the lookup process-wide.
const schemaNameCache = new Map<string, string>();

// Defense-in-depth: schema names are minted by `buildSchemaName` (strict slug
// validation) so they're already safe, but identifiers can't be parameterized —
// re-validate the shape before interpolating into `SET LOCAL search_path`.
const SAFE_SCHEMA_NAME = /^tenant_[a-z0-9_]+$/;

async function resolveSchemaName(workspaceId: string): Promise<string> {
  const cached = schemaNameCache.get(workspaceId);
  if (cached) return cached;

  const [row] = await controlDb
    .select({ schemaName: tenantCatalog.schemaName })
    .from(tenantCatalog)
    .where(eq(tenantCatalog.workspaceId, workspaceId))
    .limit(1);

  if (!row) {
    throw new NotFoundError("Workspace has no tenant schema", ErrorCode.WorkspaceNotProvisioned);
  }
  if (!SAFE_SCHEMA_NAME.test(row.schemaName)) {
    throw new Error(`Refusing to use unsafe tenant schema name: ${row.schemaName}`);
  }

  schemaNameCache.set(workspaceId, row.schemaName);
  return row.schemaName;
}

/**
 * Runs `fn` against the given workspace's tenant schema inside a transaction.
 *
 * The `PoolClient` handed to `fn` already has `search_path` set to the tenant
 * schema, so issue parameterized SQL with unqualified table names. Throwing
 * from `fn` rolls back; returning commits. The connection is always released.
 */
export async function withTenantSchema<T>(
  workspaceId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const schemaName = await resolveSchemaName(workspaceId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO "${schemaName}", public`);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Drop a cached schema-name mapping (e.g. after a workspace is deleted). */
export function clearTenantSchemaCache(workspaceId?: string): void {
  if (workspaceId) schemaNameCache.delete(workspaceId);
  else schemaNameCache.clear();
}
