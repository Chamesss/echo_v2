import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { maintenanceUrl, resolveTestDatabaseUrl, testDatabaseName } from "./db-url.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vitest global setup — runs ONCE in the main process before any test file.
 *
 *  1. Create the dedicated test database if it doesn't exist (CREATE DATABASE
 *     can't run inside a transaction, so use a plain autocommit client on the
 *     `postgres` maintenance db).
 *  2. Apply the control-plane migrations — the exact same SQL the app deploys
 *     with — so the test schema can never drift from production.
 *  3. Start from a clean slate: drop leftover `tenant_*` schemas from previous
 *     runs and truncate control data.
 *
 * Tenant schemas are created per-test by the factories against this same DB; the
 * shared pool the workers use is opened lazily on first query (see pool.ts).
 */
export default async function setup(): Promise<void> {
  loadEnv();
  const testUrl = resolveTestDatabaseUrl();
  const dbName = testDatabaseName(testUrl);

  const admin = new pg.Client({ connectionString: maintenanceUrl(testUrl) });
  await admin.connect();
  try {
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  const pool = new pg.Pool({ connectionString: testUrl });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: path.resolve(__dirname, "../drizzle/control"),
    });

    // Clean slate: tenant schemas are in their own namespaces, so drop them
    // explicitly; control data is wiped via a single cascading TRUNCATE.
    const { rows } = await pool.query<{ schema_name: string }>(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant\\_%'",
    );
    for (const { schema_name } of rows) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema_name}" CASCADE`);
    }
    await pool.query("TRUNCATE TABLE users CASCADE");
  } finally {
    await pool.end();
  }
}
