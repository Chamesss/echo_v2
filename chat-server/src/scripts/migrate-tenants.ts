/**
 * Upgrade every tenant schema to the current `TENANT_SCHEMA_VERSION`.
 *
 * Usage:  pnpm db:migrate-tenants
 *
 * New tenants are provisioned directly from `tenant/init.sql` (already current),
 * so this only touches workspaces whose `tenant_catalog.schema_version` is
 * behind. For each, it applies the numbered files in
 * `database/tenant/migrations/` whose version is `(current, target]`, in order,
 * inside one transaction per tenant with `search_path` pinned to that schema —
 * then bumps `schema_version`. A failure rolls back that tenant and aborts.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { asc, lt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { controlDb } from "../infrastructure/database/control/client.js";
import { tenantCatalog } from "../infrastructure/database/control/schema.js";
import { TENANT_SCHEMA_VERSION } from "../infrastructure/provisioning/workspace.js";
import { pool } from "../infrastructure/database/pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../infrastructure/database/tenant/migrations");

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

async function main() {
  const migrations = await loadMigrations();

  const stale = await controlDb
    .select()
    .from(tenantCatalog)
    .where(lt(tenantCatalog.schemaVersion, TENANT_SCHEMA_VERSION))
    .orderBy(asc(tenantCatalog.schemaName));

  if (stale.length === 0) {
    console.log(`✓ All tenants already at schema v${TENANT_SCHEMA_VERSION}.`);
    await pool.end();
    return;
  }

  console.log(`Upgrading ${stale.length} tenant(s) to v${TENANT_SCHEMA_VERSION}…`);

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

    console.log(
      `  ✓ ${tenant.schemaName}: v${tenant.schemaVersion} → v${TENANT_SCHEMA_VERSION} (${pending.length} migration(s))`,
    );
  }

  console.log("Done.");
  await pool.end();
}

main().catch(async (err) => {
  console.error("✗ Tenant migration failed:", err);
  await pool.end();
  process.exit(1);
});
