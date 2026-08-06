import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { asc, lt, sql } from "drizzle-orm";
import { controlDb } from "../database/control/client.js";
import { tenantCatalog } from "../database/control/schema.js";
import { logger } from "../../shared/logger/logger.js";
import { TENANT_SCHEMA_VERSION } from "./workspace.js";

/**
 * Bring every tenant schema up to `TENANT_SCHEMA_VERSION`.
 *
 * New tenants come from `tenant/init.sql` (always current), so this only touches
 * schemas that are behind, applying `(current, target]` in one transaction per
 * tenant with `search_path` pinned. A failure rolls that tenant back.
 *
 * Shared by the CLI and server boot, which is why it doesn't touch the pool —
 * each caller owns that lifecycle.
 */

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../database/tenant/migrations",
);

interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Load + sort migration files named `NNNN_description.sql`. */
async function loadMigrations(): Promise<Migration[]> {
  const files = await readdir(MIGRATIONS_DIR);
  const migrations = await Promise.all(
    files
      .filter((f) => f.endsWith(".sql"))
      .map(async (name) => {
        const version = Number.parseInt(name.slice(0, 4), 10);
        if (Number.isNaN(version)) {
          throw new Error(`Migration "${name}" must start with a 4-digit version.`);
        }
        return { version, name, sql: await readFile(path.join(MIGRATIONS_DIR, name), "utf8") };
      }),
  );
  return migrations.sort((a, b) => a.version - b.version);
}

interface MigrateTenantsResult {
  /** How many tenants were behind and have now been upgraded. */
  upgraded: number;
  target: number;
}

export async function migrateTenants(): Promise<MigrateTenantsResult> {
  const stale = await controlDb
    .select()
    .from(tenantCatalog)
    .where(lt(tenantCatalog.schemaVersion, TENANT_SCHEMA_VERSION))
    .orderBy(asc(tenantCatalog.schemaName));

  // The common case, and the one that runs on every cold start: a single indexed
  // read of `tenant_catalog` and nothing else. Reading the migration files before
  // this check would make every boot pay disk I/O for no reason.
  if (stale.length === 0) {
    return { upgraded: 0, target: TENANT_SCHEMA_VERSION };
  }

  const migrations = await loadMigrations();
  logger.info(
    { count: stale.length, target: TENANT_SCHEMA_VERSION },
    "upgrading tenant schemas",
  );

  for (const tenant of stale) {
    const pending = migrations.filter(
      (m) => m.version > tenant.schemaVersion && m.version <= TENANT_SCHEMA_VERSION,
    );

    await controlDb.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL search_path TO ${sql.identifier(tenant.schemaName)}`);
      for (const migration of pending) {
        await tx.execute(sql.raw(migration.sql));
      }
      await tx.execute(sql`SET LOCAL search_path TO public`);
      await tx
        .update(tenantCatalog)
        .set({ schemaVersion: TENANT_SCHEMA_VERSION })
        .where(sql`${tenantCatalog.workspaceId} = ${tenant.workspaceId}`);
    });

    logger.info(
      {
        schema: tenant.schemaName,
        from: tenant.schemaVersion,
        to: TENANT_SCHEMA_VERSION,
        applied: pending.length,
      },
      "tenant schema upgraded",
    );
  }

  return { upgraded: stale.length, target: TENANT_SCHEMA_VERSION };
}
