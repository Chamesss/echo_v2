import { coercePreferences, type AppearancePreferences } from "./schema";

/**
 * localStorage cache of the user's appearance preferences.
 *
 * This is a CACHE, not the source of truth — the server row wins on every
 * reconcile. Its only job is to let the inline boot script paint the right
 * theme on the first frame, before the session and preferences requests have
 * come back. Without it every reload would flash the default theme.
 *
 * Wrapped in try/catch for the same reasons as `lib/local-storage.ts`:
 * localStorage throws in private-browsing mode, when storage is full, or when
 * the host hasn't granted storage permission. A lost theme preference is not
 * worth crashing the app for.
 *
 * The key is duplicated in the boot script in index.html — change both together.
 */

export const PREFERENCES_STORAGE_KEY = "echo.appearance";

/**
 * Fired by `clearCachedPreferences` so the mounted provider drops the signed-out
 * user's theme from memory too, not just from storage.
 *
 * An event rather than a direct call because sign-out happens in components
 * that have no business knowing about the appearance provider — the same reason
 * `apiFetch` announces 401s via `UNAUTHORIZED_EVENT` instead of importing the
 * router.
 */
export const APPEARANCE_RESET_EVENT = "appearance:reset";

/** Cached preferences, or null if unset/unreadable/corrupt. */
export function readCachedPreferences(): AppearancePreferences | null {
  try {
    const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return null;
    return coercePreferences(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeCachedPreferences(prefs: AppearancePreferences): void {
  try {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

/**
 * Clears the cache — called on sign-out so the next person to use this browser
 * doesn't see the previous user's theme on the login screen, and so their own
 * server-stored preference isn't briefly overridden by a stranger's cache.
 */
export function clearCachedPreferences(): void {
  try {
    localStorage.removeItem(PREFERENCES_STORAGE_KEY);
  } catch {
    // ignore
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(APPEARANCE_RESET_EVENT));
  }
}
