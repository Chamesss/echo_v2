/**
 * Color math mirroring what the browser does for our theme tokens.
 *
 * Themes tint app surfaces with `color-mix(in oklab, …)` (see styles/themes.css).
 * That happens at paint time, so neither jsdom nor a static CSS parser can tell
 * us what the resulting surface actually looks like — which would leave the
 * readability of every themed surface unverified.
 *
 * This module reimplements that pipeline (sRGB ⇄ linear ⇄ OKLab, plus OKLCH
 * parsing and oklab mixing) so `themes.test.ts` can compute the real rendered
 * color of every surface in every theme × mode combination and assert its
 * contrast. It is the numerical stand-in for a manual visual pass.
 *
 * Formulae are Björn Ottosson's reference OKLab conversions; the contrast ratio
 * is WCAG 2.1 relative luminance.
 */

export interface Rgb {
  /** 0–1, linear-light (NOT gamma-encoded). */
  r: number;
  g: number;
  b: number;
}

export interface OkLab {
  L: number;
  a: number;
  b: number;
}

// ─── sRGB ⇄ linear ────────────────────────────────────────────────────────

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

// ─── Parsing ──────────────────────────────────────────────────────────────

/** Parses `#rgb` / `#rrggbb` into linear-light RGB. */
export function parseHex(hex: string): Rgb {
  const normalized = hex.trim().replace("#", "");
  const full =
    normalized.length === 3
      ? normalized.split("").map((c) => c + c).join("")
      : normalized;
  return {
    r: srgbToLinear(parseInt(full.slice(0, 2), 16) / 255),
    g: srgbToLinear(parseInt(full.slice(2, 4), 16) / 255),
    b: srgbToLinear(parseInt(full.slice(4, 6), 16) / 255),
  };
}

/**
 * Parses `oklch(L C H)` — the form the neutral mode palette uses in index.css.
 * An alpha component (`/ 12%`) is rejected rather than silently dropped, since
 * mixing into a translucent color changes the result's alpha too.
 */
export function parseOklch(value: string): Rgb {
  const match = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/.exec(value);
  if (!match) {
    throw new Error(`Not a plain oklch() color: ${value}`);
  }
  const [L, C, H] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const radians = (H * Math.PI) / 180;
  return okLabToRgb({
    L,
    a: C * Math.cos(radians),
    b: C * Math.sin(radians),
  });
}

/** Parses either of the color forms our theme CSS uses. */
export function parseColor(value: string): Rgb {
  const trimmed = value.trim();
  return trimmed.startsWith("#") ? parseHex(trimmed) : parseOklch(trimmed);
}

// ─── OKLab ⇄ linear RGB ───────────────────────────────────────────────────

export function rgbToOkLab({ r, g, b }: Rgb): OkLab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function okLabToRgb({ L, a, b }: OkLab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

/**
 * `color-mix(in oklab, top <percent>%, bottom)` — the exact operation the
 * browser performs for our tinted surfaces.
 */
export function mixOklab(top: Rgb, bottom: Rgb, percent: number): Rgb {
  const t = percent / 100;
  const a = rgbToOkLab(top);
  const b = rgbToOkLab(bottom);
  return okLabToRgb({
    L: a.L * t + b.L * (1 - t),
    a: a.a * t + b.a * (1 - t),
    b: a.b * t + b.b * (1 - t),
  });
}

// ─── Contrast ─────────────────────────────────────────────────────────────

/** WCAG 2.1 relative luminance. Input is linear-light, so no de-gamma here. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const clamp = (c: number) => Math.min(1, Math.max(0, c));
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
}

/** WCAG 2.1 contrast ratio, 1–21. Order-independent. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Convenience: contrast between two CSS color strings. */
export function contrastBetween(a: string, b: string): number {
  return contrastRatio(parseColor(a), parseColor(b));
}

/** Back to `#rrggbb`, for readable assertion messages. */
export function toHex({ r, g, b }: Rgb): string {
  const channel = (c: number) =>
    Math.round(Math.min(1, Math.max(0, linearToSrgb(c))) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}
