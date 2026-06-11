import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { controlDb } from '../database/control/client.js';
import { workspaces, memberships, tenantCatalog } from '../database/control/schema.js';

/**
 * Current version of the tenant schema produced by `init.sql`.
 *
 * Stored in `tenant_catalog.schema_version` at provision time. When the tenant
 * DDL changes, bump this constant, add a numbered file under
 * `database/tenant/migrations/`, and run `pnpm db:migrate-tenants` to upgrade
 * existing workspaces. The version column is what lets us know at runtime
 * whether a given workspace's schema is up to date.
 *
 * v2: messaging/versioning — user-reference columns to `text`, `messages`
 *     gains `updated_seq` + timestamps, plus the catch-up index.
 */
export const TENANT_SCHEMA_VERSION = 2;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TENANT_INIT_SQL_PATH = path.resolve(__dirname, '../database/tenant/init.sql');

let cachedInitSql: string | null = null;

/**
 * Loads (and memoizes) the tenant `init.sql` contents.
 *
 * Called by `provisionWorkspace`. Memoization avoids re-reading the file on
 * every workspace creation — the file changes only on deploy.
 */
async function loadInitSql(): Promise<string> {
  if (cachedInitSql) return cachedInitSql;
  cachedInitSql = await readFile(TENANT_INIT_SQL_PATH, 'utf8');
  return cachedInitSql;
}

const SLUG_PATTERN = /^[a-z][a-z0-9-]{2,40}$/;

/**
 * Maps a workspace slug to its Postgres schema name (`tenant_<slug>`).
 *
 * Called by `provisionWorkspace`. Slugs are user-supplied so we validate
 * strictly: lowercase, starts with a letter, ASCII only — both to reject
 * unsafe identifiers and to keep schema names predictable for ops.
 *
 * Hyphens in slugs become underscores in schema names because hyphens require
 * quoting in every SQL reference, which is brittle.
 */
function buildSchemaName(slug: string): string {
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      `Invalid slug "${slug}". Must match ${SLUG_PATTERN} (lowercase, starts with a letter).`,
    );
  }
  return `tenant_${slug.replace(/-/g, '_')}`;
}

export interface ProvisionWorkspaceInput {
  slug: string;
  ownerId: string;
}

export interface ProvisionWorkspaceResult {
  workspaceId: string;
  schemaName: string;
}

/**
 * Creates a workspace and its tenant schema atomically.
 *
 * Called by `modules/workspaces/workspaces.service.ts#createWorkspace`, which
 * is invoked from `POST /api/workspaces`.
 *
 * Single Postgres transaction:
 *   1. INSERT workspace        (fails fast on slug collision via unique constraint)
 *   2. INSERT membership       (creator becomes admin)
 *   3. CREATE SCHEMA           (transactional in Postgres — rolls back cleanly)
 *   4. Run tenant init SQL     (tables created inside the new schema via search_path)
 *   5. INSERT tenant_catalog   (registers schema name + version)
 *
 * Any failure rolls back the whole transaction. No compensating actions
 * needed — this is the key advantage of the bridge tenancy model over silo,
 * where CREATE DATABASE is non-transactional.
 */
export async function provisionWorkspace(
  input: ProvisionWorkspaceInput,
): Promise<ProvisionWorkspaceResult> {
  const schemaName = buildSchemaName(input.slug);
  const initSql = await loadInitSql();

  return controlDb.transaction(async (tx) => {
    const inserted = await tx
      .insert(workspaces)
      .values({ slug: input.slug, ownerId: input.ownerId })
      .returning({ id: workspaces.id });

    const workspace = inserted[0];
    if (!workspace) {
      throw new Error('Workspace insert returned no row');
    }

    await tx.insert(memberships).values({
      userId: input.ownerId,
      workspaceId: workspace.id,
      role: 'admin',
    });

    await tx.execute(sql`CREATE SCHEMA ${sql.identifier(schemaName)}`);
    await tx.execute(sql`SET LOCAL search_path TO ${sql.identifier(schemaName)}`);
    await tx.execute(sql.raw(initSql));
    await tx.execute(sql`SET LOCAL search_path TO public`);

    await tx.insert(tenantCatalog).values({
      workspaceId: workspace.id,
      schemaName,
      schemaVersion: TENANT_SCHEMA_VERSION,
    });

    return { workspaceId: workspace.id, schemaName };
  });
}
