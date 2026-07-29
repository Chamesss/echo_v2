/**
 * Resolves the database the test-suite runs against.
 *
 * Tests must NEVER touch the dev/prod database, so they point at a separate
 * database on the same Postgres server: the dev `DATABASE_URL` with its database
 * name suffixed `_test` (e.g. `…/postgres` → `…/postgres_test`). CI sets
 * `TEST_DATABASE_URL` explicitly to point at its dedicated service container.
 */
export function resolveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL?.trim();
  if (explicit) return explicit;

  const base = process.env.DATABASE_URL?.trim();
  if (!base) return "postgresql://postgres:postgres@localhost:5432/postgres_test";

  const url = new URL(base);
  const dbName = url.pathname.replace(/^\//, "") || "postgres";
  url.pathname = `/${dbName}_test`;
  return url.toString();
}

/** Maintenance connection (same server, `postgres` db) used to CREATE the test db. */
export function maintenanceUrl(testUrl: string): string {
  const url = new URL(testUrl);
  url.pathname = "/postgres";
  return url.toString();
}

/** The test database name (last path segment of the test URL). */
export function testDatabaseName(testUrl: string): string {
  return new URL(testUrl).pathname.replace(/^\//, "");
}
