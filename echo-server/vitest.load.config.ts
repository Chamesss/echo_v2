import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

/**
 * Load/soak runs — deliberately separate from `vitest.config.ts`.
 *
 * The main suite includes only `*.test.ts` and sets `fileParallelism: false` to
 * keep DB connections bounded while many files run back to back. Load files hold
 * hundreds of sockets and run for minutes, so they'd distort that suite's timing
 * and connection budget. Keeping them under their own `*.load.ts` extension
 * means the default `bun run test` never picks them up, while they still get
 * vitest's module mocking (the auth stub) and the shared factories.
 *
 * Run with `bun run test:load`. Sizes and durations come from env vars — see
 * each file's header.
 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["test/load/**/*.load.ts"],
      // A soak is minutes, not seconds.
      testTimeout: 10 * 60_000,
      hookTimeout: 2 * 60_000,
    },
  }),
);
