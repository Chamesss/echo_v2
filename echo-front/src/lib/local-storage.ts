/**
 * Typed wrappers around `localStorage` for the small bits of cross-session
 * UI state that don't belong on the server.
 *
 * Wrapped in try/catch because `localStorage` throws in private-browsing mode,
 * when storage is full, or when the host hasn't granted storage permission.
 * Failing silently is better UX than crashing for a non-critical preference.
 */

const LAST_WORKSPACE_KEY = "echo.last_workspace_id";

/**
 * Returns the ID of the last workspace the user visited, or null if unset.
 *
 * Called by `resolveLandingPath` after sign-in to send the user back to the
 * workspace they were in last instead of always landing on workspace #1.
 */
export function getLastWorkspaceId(): string | null {
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

/**
 * Records the workspace as the user's most recently visited.
 *
 * Called by the dashboard page on mount and by the create-workspace form
 * right after a successful creation.
 */
export function setLastWorkspaceId(id: string): void {
  try {
    localStorage.setItem(LAST_WORKSPACE_KEY, id);
  } catch {
    // ignore
  }
}

/**
 * Clears the stored workspace ID — used on sign-out so the next user on the
 * same browser doesn't get redirected into someone else's workspace.
 */
export function clearLastWorkspaceId(): void {
  try {
    localStorage.removeItem(LAST_WORKSPACE_KEY);
  } catch {
    // ignore
  }
}
