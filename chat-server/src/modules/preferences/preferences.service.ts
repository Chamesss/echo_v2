import { eq } from "drizzle-orm";
import { controlDb } from "../../infrastructure/database/control/client.js";
import { userPreferences } from "../../infrastructure/database/control/schema.js";
import {
  DEFAULT_PREFERENCES,
  appearancePreferences,
  type AppearancePreferences,
  type UpdatePreferencesBody,
} from "./preferences.dto.js";

/**
 * Per-user UI preferences.
 *
 * Two rules make this safe to run while a rolling deploy has old and new
 * clients hitting the same server:
 *
 *   READ is lenient  — a stored payload is merged field-by-field over the
 *                      defaults, and anything missing, unknown, or malformed
 *                      falls back to its default. A corrupted row renders the
 *                      default theme; it must never 500 and lock a user out of
 *                      their own settings page.
 *
 *   WRITE is a merge — the patch is applied on top of what's already stored, so
 *                      an old client that PUTs `{ mode }` cannot wipe a
 *                      preference it doesn't know exists yet.
 *
 * A missing row means "all defaults" (same convention as `notificationSettings`),
 * so nothing needs seeding at signup.
 */

/**
 * Merges a raw jsonb value over the defaults, discarding any field that fails
 * validation.
 *
 * Deliberately per-field rather than a single `safeParse` of the whole object:
 * one bad value (say a theme id removed in a later release) would otherwise
 * throw away every other preference the user had set.
 */
function coerceStored(stored: unknown): AppearancePreferences {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    return DEFAULT_PREFERENCES;
  }

  const raw = stored as Record<string, unknown>;
  const result = { ...DEFAULT_PREFERENCES };

  for (const key of Object.keys(
    appearancePreferences.shape,
  ) as (keyof AppearancePreferences)[]) {
    if (!(key in raw)) continue;
    const field = appearancePreferences.shape[key];
    const parsed = field.safeParse(raw[key]);
    if (parsed.success) {
      // Each key's parsed value matches its own field type; TS can't follow the
      // correlation through the generic key loop.
      (result as Record<string, unknown>)[key] = parsed.data;
    }
  }

  return result;
}

/** The caller's preferences, with defaults filled in for anything unset. */
export async function getPreferences(
  userId: string,
): Promise<AppearancePreferences> {
  const [row] = await controlDb
    .select({ preferences: userPreferences.preferences })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  return coerceStored(row?.preferences);
}

/**
 * Applies a partial patch and returns the full resulting payload.
 *
 * Read-modify-write rather than a jsonb merge in SQL: the merge has to run
 * through `coerceStored` anyway to sanitize whatever is already in the row, and
 * a lost update here costs at worst one re-clicked theme.
 */
export async function updatePreferences(
  userId: string,
  patch: UpdatePreferencesBody,
): Promise<AppearancePreferences> {
  const current = await getPreferences(userId);
  const next: AppearancePreferences = { ...current, ...patch };

  await controlDb
    .insert(userPreferences)
    .values({ userId, preferences: next })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { preferences: next, updatedAt: new Date() },
    });

  return next;
}
