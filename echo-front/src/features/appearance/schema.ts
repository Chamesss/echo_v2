import { z } from "zod";
import type { AppearancePreferences as ServerAppearancePreferences } from "@server/modules/preferences/preferences.dto";

/**
 * The appearance-preferences contract, client side.
 *
 * Mirrors `echo-server/src/modules/preferences/preferences.dto.ts`. The runtime
 * schema is duplicated rather than imported because pulling server code into
 * the browser bundle is a line we don't cross (the `@server` alias is
 * type-only, see vite.config.ts) — but the duplication is guarded: the
 * `PreferencesContractsMatch` assertion below fails `bun run typecheck` the
 * moment the two shapes diverge, so a field added on one side can't silently
 * go missing on the other.
 *
 * Every field has a default, so `appearancePreferences.parse({})` yields the
 * complete default payload and a malformed server response degrades to
 * defaults rather than throwing inside a render.
 */

/** Keep in sync with `styles/themes.css` (one block per id) and `themes.ts`. */
export const THEME_IDS = [
  "default",
  "aubergine",
  "ochre",
  "eggplant",
  "hoth",
  "nocturne",
  "banana",
  "terminal",
] as const;

export const themeId = z.enum(THEME_IDS);
export type ThemeId = z.infer<typeof themeId>;

export const PREFERENCES_VERSION = 1;

/**
 * Field schemas, declared ONCE and deliberately WITHOUT `.default()` — see the
 * matching note in the server DTO. A defaulted field survives `.partial()`,
 * which would turn every partial patch into a full overwrite.
 */
const preferenceFields = {
  version: z.number().int(),
  /** `system` follows the OS via `prefers-color-scheme`. */
  mode: z.enum(["light", "dark", "system"]),
  theme: themeId,
  density: z.enum(["comfortable", "compact"]),
  /** `system` honours `prefers-reduced-motion`; `always` forces motion off. */
  reducedMotion: z.enum(["system", "always"]),
} as const;

export const appearancePreferences = z.object(preferenceFields);

export type AppearancePreferences = z.infer<typeof appearancePreferences>;
export type AppearanceMode = AppearancePreferences["mode"];
/** What `mode` resolves to once `system` has been evaluated. */
export type ResolvedMode = "light" | "dark";

export const DEFAULT_PREFERENCES: AppearancePreferences = {
  version: PREFERENCES_VERSION,
  mode: "system",
  theme: "default",
  density: "comfortable",
  reducedMotion: "system",
};

/** Mutual-assignability check — `true` only when A and B are the same type. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Resolves to `true` while this file and the server's `preferences.dto.ts`
 * describe the same payload, and to `false` the moment they drift.
 *
 * `schema.test.ts` assigns `true` to it, so a divergence — a new preference
 * added on one side only, a theme id added to `THEME_IDS` here but not there —
 * fails typecheck with a clear error instead of shipping a client that writes
 * values the server rejects at runtime.
 */
export type PreferencesContractsMatch = Exact<
  AppearancePreferences,
  ServerAppearancePreferences
>;

/**
 * Parses an untrusted payload (server response or localStorage blob) field by
 * field, falling back to the default for anything invalid.
 *
 * Per-field rather than a whole-object `safeParse` for the same reason as the
 * server's `coerceStored`: one unrecognised value (a theme removed in a later
 * release, a cache written by a newer build) must not discard every other
 * preference the user has set.
 */
export function coercePreferences(input: unknown): AppearancePreferences {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return DEFAULT_PREFERENCES;
  }

  const raw = input as Record<string, unknown>;
  const result = { ...DEFAULT_PREFERENCES };

  for (const key of Object.keys(
    appearancePreferences.shape,
  ) as (keyof AppearancePreferences)[]) {
    if (!(key in raw)) continue;
    const parsed = appearancePreferences.shape[key].safeParse(raw[key]);
    if (parsed.success) {
      // Each key's parsed value matches its own field type; TS can't follow
      // the correlation through the generic key loop.
      (result as Record<string, unknown>)[key] = parsed.data;
    }
  }

  return result;
}
