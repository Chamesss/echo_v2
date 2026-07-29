import { z } from "zod";

/**
 * The appearance-preferences contract.
 *
 * This file is the single source of truth for what a user preference payload
 * may contain. The frontend mirrors it in
 * `echo-front/src/features/appearance/schema.ts` — there is no shared package
 * between the two, so the duplication is deliberate and the shapes must be kept
 * in step (the round-trip test in `test/unit/preferences.test.ts` and the
 * frontend's own schema test both assert the field set).
 *
 * Adding a preference = add a field here (with a default) and a control in the
 * frontend's `AppearanceSection`. No migration: the whole payload is one jsonb
 * column. See `preferences.service.ts` for how old and new clients coexist.
 */

/**
 * Sidebar themes are a CLOSED set. Users pick from curated presets rather than
 * supplying colors, which means every theme can be contrast-checked in CI and
 * we never store attacker-controlled values that end up in a CSS context.
 *
 * Keep in sync with `echo-front/src/styles/themes.css` (one block per id) and
 * the registry in `echo-front/src/features/appearance/themes.ts`.
 */
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

/** Bumped only if a payload needs a real migration; readers tolerate any value. */
export const PREFERENCES_VERSION = 1;

/**
 * The field schemas, declared ONCE and deliberately WITHOUT `.default()`.
 *
 * Defaults live in `DEFAULT_PREFERENCES` below instead, because a defaulted
 * field survives `.partial()`: `z.object({ mode: x.default("system") }).partial()`
 * still injects `mode` when the key is absent. That would turn every partial
 * PUT into a full overwrite — an old client patching `{ mode }` would silently
 * reset `density` to its default. Keeping defaults out of the schema makes
 * "omitted" genuinely mean "unchanged".
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

/** The complete payload. Used for responses and for per-field coercion. */
export const appearancePreferences = z.object(preferenceFields);

export type AppearancePreferences = z.infer<typeof appearancePreferences>;

export const DEFAULT_PREFERENCES: AppearancePreferences = {
  version: PREFERENCES_VERSION,
  mode: "system",
  theme: "default",
  density: "comfortable",
  reducedMotion: "system",
};

/**
 * PUT body. Partial so a client can send just the field it changed, and so an
 * OLDER client (which doesn't know about a newer preference) can't blank it out
 * by omission — see `updatePreferences`. Unknown keys are stripped by zod's
 * default object behaviour, which the `validate` middleware relies on.
 */
export const updatePreferencesBody = appearancePreferences
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Provide at least one preference to update",
  });

export type UpdatePreferencesBody = z.infer<typeof updatePreferencesBody>;
