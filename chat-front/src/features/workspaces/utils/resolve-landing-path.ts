import { getLastWorkspaceId } from "@/lib/local-storage";
import { paths } from "@/lib/paths";
import type { Workspace } from "../api/use-my-workspaces";

/**
 * Decides where to send the user after sign-in.
 *
 * Called by `routes/index.tsx` once the my-workspaces query resolves.
 * Strategy:
 *   1. No workspaces at all → /workspaces/create (first-run experience)
 *   2. There's a stored "last workspace" AND it's still in the user's list
 *      → /dashboard/{lastUsed} (returning users land where they left off)
 *   3. Otherwise → /dashboard/{first}
 *
 * Step 2's existence check is what prevents an infinite redirect loop after
 * the user gets removed from a workspace: a stale localStorage entry can't
 * win against the live workspace list.
 */
export function resolveLandingPath(workspaces: Workspace[]): string {
  if (workspaces.length === 0) return paths.workspaceCreate;

  const last = getLastWorkspaceId();
  if (last) {
    const found = workspaces.find((w) => w.id === last);
    if (found) return paths.workspace(found.id);
  }

  return paths.workspace(workspaces[0]!.id);
}
