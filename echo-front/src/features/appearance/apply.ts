import { getTheme } from "./themes";
import type {
  AppearanceMode,
  AppearancePreferences,
  ResolvedMode,
} from "./schema";

/**
 * The single writer of appearance state onto the DOM.
 *
 * Everything that themes the app is expressed as attributes on <html>:
 *
 *   class="dark"                → mode layer   (index.css)
 *   data-theme="<id>"           → theme layer  (styles/themes.css)
 *   data-density="<density>"
 *   data-reduced-motion="<value>"
 *
 * The inline boot script in index.html sets these SAME attributes before first
 * paint so there's no flash; this module then owns them for the rest of the
 * session. The two must agree — `apply.test.ts` asserts the contract, and the
 * boot script is commented with a pointer back here.
 */

/** Media query used to resolve `mode: "system"`. */
export const DARK_QUERY = "(prefers-color-scheme: dark)";

/** True when the OS currently prefers dark. Safe to call outside a browser. */
export function prefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(DARK_QUERY).matches;
}

/** Collapses `system` into a concrete light/dark using the OS preference. */
export function resolveMode(mode: AppearanceMode): ResolvedMode {
  if (mode === "system") return prefersDark() ? "dark" : "light";
  return mode;
}

/**
 * Writes the full preference set to <html>.
 *
 * Idempotent, so it's safe to call on every reconcile — the browser only
 * repaints when a value actually changes.
 */
export function applyPreferences(prefs: AppearancePreferences): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const resolved = resolveMode(prefs.mode);

  root.classList.toggle("dark", resolved === "dark");
  root.dataset.theme = prefs.theme;
  root.dataset.density = prefs.density;
  root.dataset.reducedMotion = prefs.reducedMotion;

  syncThemeColor(prefs);
}

/**
 * Keeps `<meta name="theme-color">` matching the sidebar so mobile browser
 * chrome (Safari's toolbar, Android's status bar) blends with the app instead
 * of showing a stale white bar.
 *
 * Uses the swatch metadata rather than a computed style: this can run before
 * the stylesheet has applied, and reading computed styles here would force a
 * layout on every preference change.
 */
function syncThemeColor(prefs: AppearancePreferences): void {
  const theme = getTheme(prefs.theme);
  // The alias theme has no fixed color; fall back to the mode's page color.
  const color =
    prefs.theme === "default"
      ? resolveMode(prefs.mode) === "dark"
        ? "#0a0a0a"
        : "#ffffff"
      : theme.swatch[0];

  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = color;
}
