import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ALIAS_THEME_IDS, THEMES } from "./themes";
import { THEME_IDS } from "./schema";
import {
  contrastBetween,
  contrastRatio,
  mixOklab,
  parseColor,
  parseHex,
  toHex,
  type Rgb,
} from "./color";

/**
 * The guard that makes adding a theme safe.
 *
 * Theme colors live in CSS and theme metadata lives in TS (see themes.ts for
 * why), so three things have to agree: `THEME_IDS`, the registry, and the CSS
 * blocks. These tests fail loudly when they don't — and, more importantly,
 * fail when a new theme is unreadable, which is the failure mode a human
 * reviewer is least likely to catch.
 */

// Resolved from the project root rather than `import.meta.url`: under jsdom,
// Vitest rewrites `import.meta.url` to an http:// URL that `fileURLToPath`
// rejects.
const CSS_PATH = resolve(process.cwd(), "src/styles/themes.css");
const css = readFileSync(CSS_PATH, "utf8");

/** Every token a theme block must define. */
const REQUIRED_TOKENS = [
  "--sidebar",
  "--sidebar-foreground",
  "--sidebar-muted-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--sidebar-active",
  "--sidebar-active-foreground",
  "--sidebar-border",
  "--sidebar-badge",
  "--sidebar-badge-foreground",
  "--sidebar-ring",
] as const;

/** Pairs that must stay legible, with their WCAG 2.1 minimum. */
const CONTRAST_PAIRS: ReadonlyArray<{
  fg: string;
  bg: string;
  min: number;
  what: string;
}> = [
  { fg: "--sidebar-foreground", bg: "--sidebar", min: 4.5, what: "body text" },
  { fg: "--sidebar-muted-foreground", bg: "--sidebar", min: 4.5, what: "secondary text" },
  { fg: "--sidebar-accent-foreground", bg: "--sidebar-accent", min: 4.5, what: "hovered row text" },
  { fg: "--sidebar-active-foreground", bg: "--sidebar-active", min: 4.5, what: "active row text" },
  { fg: "--sidebar-badge-foreground", bg: "--sidebar-badge", min: 4.5, what: "unread badge text" },
  // Non-text UI affordance — 3:1 per WCAG 1.4.11.
  { fg: "--sidebar-ring", bg: "--sidebar", min: 3, what: "focus ring" },
  // The app-wide accent: primary buttons and active states across every page,
  // not just the sidebar.
  { fg: "--theme-accent-foreground", bg: "--theme-accent", min: 4.5, what: "primary button text" },
];

/**
 * Caps on how much `--theme-tint` may be mixed into an app surface.
 *
 * This is what lets themes repaint the whole app WITHOUT re-auditing contrast
 * per component: themes never override the text tokens, so as long as a tinted
 * surface stays within a few percent of its neutral equivalent, the neutral
 * palette's ratios carry over. Raise these and that guarantee stops holding.
 */
const MAX_TINT = { light: 16, dark: 32 } as const;

/** Splits a `{ ... }` body into `--token: value` pairs. */
function parseDeclarations(body: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  // Strip comments first so `/* note: x */` can't be read as a declaration.
  for (const line of body.replace(/\/\*[\s\S]*?\*\//g, "").split(";")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const name = line.slice(0, separator).trim();
    if (!name.startsWith("--")) continue;
    declarations[name] = line.slice(separator + 1).trim();
  }
  return declarations;
}

/**
 * The declarations of a theme's own `:root[data-theme="id"] { … }` block.
 *
 * Anchored to that exact selector so it can't accidentally match the shared
 * derived-surfaces rule, whose selector contains `[data-theme="default"]`
 * inside a `:not()`.
 */
function parseThemeBlock(id: string): Record<string, string> | null {
  const match = new RegExp(
    `:root\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`,
  ).exec(css);
  return match ? parseDeclarations(match[1]!) : null;
}

/** The shared rules that derive app surfaces from `--theme-tint`. */
function parseDerivedRule(dark: boolean): Record<string, string> {
  const selector = dark
    ? `:root\\[data-theme\\]:not\\(\\[data-theme="default"\\]\\)\\.dark`
    : `:root\\[data-theme\\]:not\\(\\[data-theme="default"\\]\\)`;
  const match = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(css);
  expect(match, `missing derived rule (dark=${dark})`).not.toBeNull();
  return parseDeclarations(match![1]!);
}

/** Absolute themes only — alias themes delegate to the mode layer. */
const absoluteThemeIds = THEME_IDS.filter(
  (id) => !ALIAS_THEME_IDS.includes(id),
);

describe("theme registry ↔ CSS parity", () => {
  it("registers exactly the ids in THEME_IDS", () => {
    expect(THEMES.map((t) => t.id).sort()).toEqual([...THEME_IDS].sort());
  });

  it.each(THEME_IDS)("defines a CSS block for %s", (id) => {
    expect(parseThemeBlock(id)).not.toBeNull();
  });

  it("has no CSS block for an unregistered theme", () => {
    const declared = [...css.matchAll(/\[data-theme="([^"]+)"\]/g)].map(
      (m) => m[1]!,
    );
    for (const id of new Set(declared)) {
      expect(THEME_IDS).toContain(id);
    }
  });

  // A partial block silently inherits the PREVIOUS theme's color for the
  // missing token, which is near-impossible to spot by eye.
  it.each(THEME_IDS)("%s defines every required token", (id) => {
    const block = parseThemeBlock(id)!;
    for (const token of REQUIRED_TOKENS) {
      expect(block[token], `${id} is missing ${token}`).toBeTruthy();
    }
  });

  it.each(absoluteThemeIds)("%s uses literal colors, not var() aliases", (id) => {
    const block = parseThemeBlock(id)!;
    for (const token of REQUIRED_TOKENS) {
      expect(block[token], `${id}.${token} should be a hex literal`).toMatch(
        /^#[0-9a-f]{3,8}$/i,
      );
    }
  });

  // Without a tint seed a theme would silently fall back to the neutral
  // palette for the whole app and only color the sidebar.
  it.each(absoluteThemeIds)("%s defines the app-tint seeds", (id) => {
    const block = parseThemeBlock(id)!;
    for (const seed of [
      "--theme-tint",
      "--theme-accent",
      "--theme-accent-foreground",
    ]) {
      expect(block[seed], `${id} is missing ${seed}`).toMatch(/^#[0-9a-f]{3,8}$/i);
    }
  });

  it.each(absoluteThemeIds)("%s swatch matches its CSS", (id) => {
    const block = parseThemeBlock(id)!;
    const meta = THEMES.find((t) => t.id === id)!;
    expect(meta.swatch).toEqual([
      block["--sidebar"],
      block["--sidebar-active"],
      block["--sidebar-foreground"],
      block["--sidebar-muted-foreground"],
    ]);
  });
});

describe("theme contrast (WCAG 2.1)", () => {
  for (const id of absoluteThemeIds) {
    const block = parseThemeBlock(id)!;

    for (const { fg, bg, min, what } of CONTRAST_PAIRS) {
      it(`${id}: ${what} meets ${min}:1`, () => {
        const ratio = contrastBetween(block[fg]!, block[bg]!);
        expect(
          Number(ratio.toFixed(2)),
          `${id} ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`,
        ).toBeGreaterThanOrEqual(min);
      });
    }
  }
});

/**
 * The numerical stand-in for a manual dark-mode/theme visual pass.
 *
 * App surfaces are produced at PAINT time by `color-mix`, so no amount of CSS
 * parsing reveals what they actually look like. Here we reproduce the browser's
 * oklab mix (see color.ts) for every theme × mode × surface and assert the text
 * that lands on it is readable — 7 themes × 2 modes × 4 surfaces, which is far
 * more combinations than anyone would check by eye.
 *
 * Text tokens come from the NEUTRAL palette in index.css, because themes are
 * forbidden from overriding them (asserted above).
 */
describe("tinted app surfaces stay readable", () => {
  /** Neutral text + base surface values, mirroring index.css. */
  const NEUTRAL = {
    light: {
      base: "oklch(1 0 0)",
      foreground: "oklch(0.145 0 0)",
      mutedForeground: "oklch(0.5 0 0)",
    },
    dark: {
      base: "oklch(0.145 0 0)",
      foreground: "oklch(0.985 0 0)",
      mutedForeground: "oklch(0.708 0 0)",
    },
  } as const;

  /** Surfaces text sits on, with the tint each uses per mode. */
  const SURFACES = [
    { token: "--background", light: 3, dark: 14 },
    { token: "--card", light: 1.5, dark: 18 },
    { token: "--muted", light: 7, dark: 22 },
    { token: "--accent", light: 9, dark: 26 },
  ] as const;

  /** Reads the tint percentages straight from the CSS so they can't drift. */
  function tintPercent(token: string, dark: boolean): number {
    const rule = parseDerivedRule(dark);
    const match = /var\(--theme-tint\)\s+([\d.]+)%/.exec(rule[token] ?? "");
    expect(match, `${token} is not tint-derived (dark=${dark})`).not.toBeNull();
    return Number(match![1]);
  }

  for (const mode of ["light", "dark"] as const) {
    const neutral = NEUTRAL[mode];
    const base: Rgb = parseColor(neutral.base);

    for (const surface of SURFACES) {
      // The percentages in SURFACES are documentation; the CSS is the source of
      // truth, so a change there fails here rather than going unnoticed.
      it(`${mode}: ${surface.token} tint matches the CSS`, () => {
        expect(tintPercent(surface.token, mode === "dark")).toBe(surface[mode]);
      });

      for (const id of absoluteThemeIds) {
        const tint = parseHex(parseThemeBlock(id)!["--theme-tint"]!);

        it(`${mode}/${id}: text on ${surface.token} meets 4.5:1`, () => {
          const mixed = mixOklab(tint, base, surface[mode]);

          for (const [label, text] of [
            ["foreground", neutral.foreground],
            ["muted-foreground", neutral.mutedForeground],
          ] as const) {
            const ratio = contrastRatio(mixed, parseColor(text));
            expect(
              Number(ratio.toFixed(2)),
              `${id} ${label} on ${surface.token} (${toHex(mixed)}) is ` +
                `${ratio.toFixed(2)}:1, needs 4.5:1`,
            ).toBeGreaterThanOrEqual(4.5);
          }
        });
      }
    }
  }
});

describe("app-surface tint bounds", () => {
  // Themes tint surfaces via a shared color-mix rule rather than per-theme
  // overrides, so these two rules are the ONLY place the ratios are set — which
  // is what makes a single bounds check sufficient for all themes.
  it.each([
    { mode: "light" as const, dark: false },
    { mode: "dark" as const, dark: true },
  ])("$mode surfaces stay within the tint cap", ({ mode, dark }) => {
    const rule = parseDerivedRule(dark);
    const percentages = Object.entries(rule).flatMap(([token, value]) => {
      const match = /var\(--theme-tint\)\s+([\d.]+)%/.exec(value);
      return match ? [{ token, percent: Number(match[1]) }] : [];
    });

    expect(percentages.length).toBeGreaterThan(0);
    for (const { token, percent } of percentages) {
      expect(
        percent,
        `${token} mixes ${percent}% tint, over the ${mode} cap of ${MAX_TINT[mode]}%`,
      ).toBeLessThanOrEqual(MAX_TINT[mode]);
    }
  });

  // Themes must not touch text tokens: those are what carry contrast, and
  // leaving them neutral is precisely why the tint cap is a sufficient check.
  it.each(absoluteThemeIds)("%s does not override any text token", (id) => {
    const block = parseThemeBlock(id)!;
    const textTokens = Object.keys(block).filter(
      (token) =>
        token.endsWith("-foreground") &&
        !token.startsWith("--sidebar") &&
        token !== "--theme-accent-foreground",
    );
    expect(textTokens).toEqual([]);
  });

  it("derives surfaces from the tint rather than per-theme overrides", () => {
    // If a theme block started setting --background directly it would escape
    // the capped rule above, so the bounds check would stop meaning anything.
    for (const id of absoluteThemeIds) {
      const block = parseThemeBlock(id)!;
      for (const surface of ["--background", "--card", "--muted", "--accent"]) {
        expect(block[surface], `${id} overrides ${surface} directly`).toBeUndefined();
      }
    }
  });
});

/**
 * Sanity-checks the color math, so a bug in the checker can't quietly pass
 * every theme above.
 */
describe("color helpers", () => {
  it("computes the known contrast extremes", () => {
    expect(contrastBetween("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastBetween("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("is order-independent", () => {
    expect(contrastBetween("#3f0e40", "#ffffff")).toBeCloseTo(
      contrastBetween("#ffffff", "#3f0e40"),
      5,
    );
  });

  it("round-trips a color through OKLab", () => {
    for (const hex of ["#3f0e40", "#1164a3", "#fbe7a1", "#0b0f0b"]) {
      expect(toHex(parseHex(hex))).toBe(hex);
    }
  });

  it("parses the oklch() form used by the neutral palette", () => {
    expect(toHex(parseColor("oklch(1 0 0)"))).toBe("#ffffff");
    // Achromatic oklch stays neutral grey through the conversion.
    expect(toHex(parseColor("oklch(0.145 0 0)"))).toMatch(/^#(\w\w)\1\1$/);
  });

  it("mixes toward each endpoint as the percentage moves", () => {
    const purple = parseHex("#3f0e40");
    const white = parseHex("#ffffff");
    expect(toHex(mixOklab(purple, white, 100))).toBe("#3f0e40");
    expect(toHex(mixOklab(purple, white, 0))).toBe("#ffffff");
    // A small tint must stay far closer to white than to the tint.
    const tinted = mixOklab(purple, white, 3);
    expect(contrastRatio(tinted, white)).toBeLessThan(1.2);
  });
});
