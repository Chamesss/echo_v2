/** Longest slug the create form (and `createWorkspaceSchema`) accepts. */
export const SLUG_MAX_LENGTH = 40;

/** Combining diacritical marks, left behind by NFKD (é → "e" + U+0301). */
const COMBINING_MARKS = /\p{Diacritic}/gu;

/**
 * Coerces free-form typing into a valid workspace slug, live, on every keystroke.
 *
 * Wired to the slug field's `onChange` in `CreateWorkspaceForm`. Without it the
 * natural thing to type — "Acme Corp" — is simply rejected by
 * `createWorkspaceSchema`, which is technically correct and useless: the user is
 * told what's wrong but has to hand-convert it. Normalizing instead means a
 * space (or an accent, or capitals, or a pasted URL fragment) can never land in
 * the field at all, so the regex error is reserved for the one rule we can't
 * fix silently — "must start with a letter".
 *
 * Rules, in order:
 *   1. Strip accents (é → e) so "café" becomes "cafe", not "caf-".
 *   2. Lowercase.
 *   3. Drop leading whitespace — otherwise " acme" would open with a hyphen.
 *   4. Any run of disallowed characters (spaces included) → a single hyphen.
 *   5. Collapse hyphen runs, drop leading hyphens, cap the length.
 *
 * TRAILING hyphens are deliberately kept: they're what a half-typed "acme-" or
 * "acme " looks like, and stripping them would make the hyphen key feel broken.
 * `createWorkspaceSchema` accepts them, and the backend's `tenant_<slug>` schema
 * name tolerates them, so there's nothing to protect against here.
 */
export function normalizeSlugInput(value: string): string {
  return value
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/^\s+/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .slice(0, SLUG_MAX_LENGTH);
}

/**
 * Tidies the hyphen `normalizeSlugInput` leaves dangling once the user is done.
 *
 * Called from the field's `onBlur`, not its `onChange`: while the field has
 * focus a trailing hyphen is load-bearing (it's how "acme " and a half-typed
 * "acme-" render), but committing "acme-corp-" as the workspace's permanent URL
 * because the user typed a trailing space is not what they meant.
 */
export function finalizeSlugInput(value: string): string {
  return value.replace(/-+$/, "");
}
