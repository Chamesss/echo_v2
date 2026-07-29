import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "@/lib/auth-client";
import { usePreferences, useUpdatePreferences } from "./api/use-preferences";
import { applyPreferences, prefersDark, DARK_QUERY } from "./apply";
import {
  APPEARANCE_RESET_EVENT,
  readCachedPreferences,
  writeCachedPreferences,
} from "./storage";
import {
  DEFAULT_PREFERENCES,
  type AppearancePreferences,
  type ResolvedMode,
} from "./schema";

/**
 * Owns appearance state for the whole app.
 *
 * Resolution order, cheapest first:
 *
 *   1. The inline boot script in index.html has already applied the CACHED
 *      preferences to <html> before first paint — so by the time this mounts,
 *      the app is already painted correctly and there is no flash.
 *   2. This provider seeds its state from the same cache, then (only when
 *      signed in) fetches the server row and reconciles. The SERVER WINS —
 *      that's what makes a theme follow the user to a new browser.
 *   3. Every change writes through to both the server and the cache.
 *
 * Signed-out routes (login, register, accept-invite) still theme correctly from
 * the cache; the query is disabled there so they never 401.
 */

interface AppearanceContextValue {
  preferences: AppearancePreferences;
  /** `mode` with `system` collapsed to light/dark — what's actually on screen. */
  resolvedMode: ResolvedMode;
  setPreferences: (patch: Partial<AppearancePreferences>) => void;
  /** True while a write is in flight (the UI stays interactive regardless). */
  isSaving: boolean;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending: sessionPending } = useSession();
  const isSignedIn = Boolean(session?.user) && !sessionPending;

  const { data: serverPreferences } = usePreferences(isSignedIn);
  const { mutate: save, isPending: isSaving } = useUpdatePreferences();

  // Seeded from the cache so the first render matches what the boot script
  // already painted. Lazy initialiser — localStorage is read once, not on
  // every render.
  const [local, setLocal] = useState<AppearancePreferences>(
    () => readCachedPreferences() ?? DEFAULT_PREFERENCES,
  );

  // Tracked in state (not read on demand) so `resolvedMode` is reactive — a
  // consumer that renders differently in dark mode has to re-render when the OS
  // flips, not just have the CSS class swapped underneath it.
  const [systemDark, setSystemDark] = useState(prefersDark);

  // The server row is authoritative once it arrives.
  const preferences = serverPreferences ?? local;
  const resolvedMode: ResolvedMode =
    preferences.mode === "system"
      ? systemDark
        ? "dark"
        : "light"
      : preferences.mode;

  // Apply to the DOM + refresh the cache whenever the effective value changes.
  // The boot script did the first paint; this keeps <html> in step afterwards
  // and re-caches so the NEXT cold load paints the server's value immediately.
  useEffect(() => {
    applyPreferences(preferences);
    writeCachedPreferences(preferences);
  }, [preferences, systemDark]);

  // One listener for the whole app, attached regardless of mode: it only feeds
  // state, and `resolvedMode` ignores it unless the user is following the OS.
  // Re-reading `matches` on attach closes the gap where the OS changed between
  // the lazy initialiser and this effect.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const query = window.matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    setSystemDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Sign-out clears the cache and announces it; drop the departing user's theme
  // from memory too, so the login screen shows the default rather than theirs.
  useEffect(() => {
    const onReset = () => setLocal(DEFAULT_PREFERENCES);
    window.addEventListener(APPEARANCE_RESET_EVENT, onReset);
    return () => window.removeEventListener(APPEARANCE_RESET_EVENT, onReset);
  }, []);

  const setPreferences = useCallback(
    (patch: Partial<AppearancePreferences>) => {
      // Update local state first so the change is instant even when signed out
      // (where there's no mutation to be optimistic about).
      setLocal((current) => ({ ...(serverPreferences ?? current), ...patch }));
      if (isSignedIn) save(patch);
    },
    [isSignedIn, save, serverPreferences],
  );

  const value = useMemo<AppearanceContextValue>(
    () => ({ preferences, resolvedMode, setPreferences, isSaving }),
    [preferences, resolvedMode, setPreferences, isSaving],
  );

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

/**
 * Read + update the current appearance preferences.
 *
 * Throws outside the provider rather than returning defaults, so a component
 * mounted in the wrong place fails loudly in dev instead of silently rendering
 * the default theme forever.
 */
export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext);
  if (!context) {
    throw new Error("useAppearance must be used within an AppearanceProvider");
  }
  return context;
}
