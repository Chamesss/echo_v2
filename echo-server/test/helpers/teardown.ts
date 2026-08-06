import { pool } from "../../src/infrastructure/database/pool.js";
import { backplane } from "../../src/infrastructure/realtime/backplane.js";
import { destroyWorkspace, type TestWorkspace } from "../factories.js";

/**
 * End of an integration test file. The ORDER is why this is shared: workspaces
 * need a live pool, and the backplane holds its own LISTEN connection that must
 * close before the pool goes. Getting it wrong shows up as post-run noise
 * blamed on whichever file ran last.
 *
 * Workspaces are `| undefined` because a `beforeAll` can fail partway and
 * teardown still runs.
 *
 * Not used by the four realtime files — they import `pool`/`backplane` through
 * `await import(...)` after mocking auth, and close an HTTP server first.
 */
export async function teardown(
  ...workspaces: ReadonlyArray<TestWorkspace | undefined>
): Promise<void> {
  for (const ws of workspaces) {
    if (ws) await destroyWorkspace(ws);
  }
  await backplane.close();
  await pool.end();
}
