import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";
import { resolveTestDatabaseUrl } from "./test/db-url";

// Load echo-server/.env so the test DB can be derived from the real connection.
// (Only the DB host/credentials are borrowed; the test run uses a SEPARATE
// database and a throwaway auth secret — never the real secrets in .env.)
loadEnv();

export default defineConfig({
  plugins: [
    // The app source uses NodeNext `.js` import specifiers (e.g. "./pool.js")
    // that physically point at `.ts` files. Vite resolves explicit extensions
    // literally and won't fall back, so map a relative `.js` import to its `.ts`
    // sibling at resolve time. Bare (node_modules) specifiers are untouched.
    {
      name: "resolve-js-to-ts",
      enforce: "pre",
      async resolveId(source, importer, options) {
        if (
          importer &&
          source.endsWith(".js") &&
          (source.startsWith("./") || source.startsWith("../"))
        ) {
          const resolved = await this.resolve(`${source.slice(0, -3)}.ts`, importer, {
            ...options,
            skipSelf: true,
          });
          if (resolved) return resolved;
        }
        return null;
      },
    },
  ],
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    // Integration tests hit a real shared Postgres. Run files serially (not in
    // parallel) so connection counts stay bounded and ordering is deterministic.
    // `isolate` stays at its default (true): each file gets a fresh module
    // registry — so each file owns and tears down its own connection pool.
    pool: "forks",
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    // Injected into process.env BEFORE any app module loads. dotenv (in env.ts)
    // won't override these, so the test DB + throwaway secret always win.
    env: {
      NODE_ENV: "test",
      DATABASE_URL: resolveTestDatabaseUrl(),
      // Above the 15s production default: the suite runs against a REMOTE
      // database, and the 25-writer race serializes on a row lock (~700ms per
      // writer from a dev machine). `testTimeout` still catches a real hang.
      DB_STATEMENT_TIMEOUT_MS: "60000",
      BETTER_AUTH_SECRET: "test-only-secret-not-used-for-anything-real",
      BETTER_AUTH_URL: "http://localhost:4000",
      CORS_ORIGINS: "http://localhost:3000",
    },
  },
});
