import type { ThemeId } from "./schema";

/**
 * Display metadata for the theme picker.
 *
 * Deliberately metadata ONLY — the actual token values live in
 * `styles/themes.css` and are applied by flipping `data-theme` on
 * <html>. Keeping colors in CSS means nothing has to be injected at boot, the
 * themes minify and cache with the rest of the bundle, and there's no inline
 * `style` for a CSP to reject.
 *
 * `swatch` duplicates four colors from the CSS so the picker can draw a preview
 * without mounting a hidden element and reading computed styles. That
 * duplication is the one drift risk in this design, so `themes.test.ts` parses
 * the CSS and asserts every swatch matches its block. Update both together.
 */
export interface ThemeMeta {
  id: ThemeId;
  label: string;
  description: string;
  /** [sidebar, active, foreground, mutedForeground] — drawn as a mini sidebar. */
  swatch: [string, string, string, string];
}

export const THEMES: readonly ThemeMeta[] = [
  {
    id: "default",
    label: "Clean & Simple",
    description: "Follows your light/dark setting.",
    // Alias theme — resolves to the mode tokens at runtime, so these are
    // stand-ins for the picker only and are exempt from the CSS parity check.
    swatch: ["#f4f4f5", "#18181b", "#18181b", "#71717a"],
  },
  {
    id: "aubergine",
    label: "Aubergine",
    description: "Deep purple with a blue highlight.",
    swatch: ["#3f0e40", "#1164a3", "#ffffff", "#bcabbc"],
  },
  {
    id: "ochre",
    label: "Ochre",
    description: "Warm brown with amber accents.",
    swatch: ["#4b2e19", "#b45309", "#ffffff", "#d7bfa6"],
  },
  {
    id: "eggplant",
    label: "Eggplant",
    description: "Muted violet, softer than Aubergine.",
    swatch: ["#4a3b5c", "#7c5cbf", "#ffffff", "#c9bed8"],
  },
  {
    id: "hoth",
    label: "Hoth",
    description: "Light sidebar, even in dark mode.",
    swatch: ["#f8f9fb", "#1164a3", "#1d1c1d", "#616061"],
  },
  {
    id: "nocturne",
    label: "Nocturne",
    description: "Deep navy for low-light rooms.",
    swatch: ["#12172b", "#2563eb", "#ffffff", "#a3adc9"],
  },
  {
    id: "banana",
    label: "Banana",
    description: "Bright yellow with dark text.",
    swatch: ["#fbe7a1", "#7a5c00", "#2a2100", "#6b5a12"],
  },
  {
    id: "terminal",
    label: "Terminal",
    description: "Green on black.",
    swatch: ["#0b0f0b", "#1f7a34", "#d6ffd6", "#74a874"],
  },
] as const;

/**
 * The alias theme delegates its colors to the mode layer, so its swatch is
 * illustrative rather than a copy of the CSS. Excluded from parity + contrast
 * checks, which cover absolute themes.
 */
export const ALIAS_THEME_IDS: readonly ThemeId[] = ["default"];

export function getTheme(id: ThemeId): ThemeMeta {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}
