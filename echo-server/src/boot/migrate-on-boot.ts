import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { env } from "../config/env.js";
import { controlDb } from "../infrastructure/database/control/client.js";
import { migrateTenants } from "../infrastructure/provisioning/migrate-tenants.js";
import { logger } from "../shared/logger/logger.js";

/**
 * Bring the database to this build's schema before serving traffic.
 *
 * Migrations are per-deploy, not one-time, so they can't be a manual step: a
 * deploy that adds one and doesn't get a human into a shell leaves the database
 * behind the code. Control plane first (tenant migrations may depend on it).
 *
 * Uses drizzle-orm's programmatic migrator, not the `drizzle-kit` CLI — that's a
 * dev tool and shouldn't be needed in the image.
 *
 * Callers must refuse to listen if this rejects; a server on a stale schema
 * looks healthy and fails real work.
 */
const CONTROL_MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../drizzle/control",
);

export async function migrateOnBoot(): Promise<void> {
  // Tests own their schema lifecycle (see test/global-setup.ts).
  if (env.NODE_ENV === "test") return;

  const startedAt = Date.now();
  await migrate(controlDb, { migrationsFolder: CONTROL_MIGRATIONS_DIR });
  const { upgraded, target } = await migrateTenants();

  logger.info(
    { ms: Date.now() - startedAt, tenantsUpgraded: upgraded, tenantSchemaVersion: target },
    "schema up to date",
  );
}
