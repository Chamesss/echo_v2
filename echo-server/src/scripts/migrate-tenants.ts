/**
 * Upgrade every tenant schema to the current `TENANT_SCHEMA_VERSION`.
 *
 * Usage:  bun run db:migrate-tenants
 *
 * A thin CLI over `migrateTenants()` — the logic lives in
 * `infrastructure/provisioning/migrate-tenants.ts` because the server also runs
 * it at boot, and two copies of a migration runner is exactly the kind of
 * duplication that ends with one of them being subtly out of date.
 *
 * All this adds is the process lifecycle: close the pool, and exit non-zero on
 * failure so a CI step or a one-off job actually fails.
 */
import { migrateTenants } from "../infrastructure/provisioning/migrate-tenants.js";
import { pool } from "../infrastructure/database/pool.js";

try {
  const { upgraded, target } = await migrateTenants();
  console.log(
    upgraded === 0
      ? `✓ All tenants already at schema v${target}.`
      : `✓ Upgraded ${upgraded} tenant(s) to v${target}.`,
  );
  await pool.end();
} catch (err) {
  console.error("✗ Tenant migration failed:", err);
  await pool.end();
  process.exit(1);
}
