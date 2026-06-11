/**
 * Slug utility — text → URL-safe identifier.
 *
 * Used by anywhere that needs to derive a slug from arbitrary user input
 * (workspace name suggestion, future channel renames, S3 path components
 * built from user-supplied names, etc.). Workspace creation accepts the
 * slug directly from the form, but we keep `slugify` available so a future
 * "auto-suggest" feature can compose without re-implementing the rules.
 *
 * Algorithm:
 *   1. Lowercase
 *   2. Normalize to NFKD and strip combining marks (handles accents like é → e)
 *   3. Replace runs of non-alphanumeric with a single hyphen
 *   4. Trim leading/trailing hyphens
 *   5. Cap length at `maxLength` (default 50)
 *
 * Result is guaranteed to match /^[a-z0-9][a-z0-9-]*[a-z0-9]?$/ — safe for
 * URLs and as a fragment in S3 keys.
 */
export function slugify(input: string, options: { maxLength?: number } = {}): string {
  const maxLength = options.maxLength ?? 50;
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
}

/**
 * Reserved slugs that must never be assigned to user-created entities
 * (workspaces, future channels) because they'd collide with system routes
 * or have ambiguous meaning.
 *
 * Checked by `provisionWorkspace` before insert. Add to this set whenever
 * a new system route is added under a path that would shadow the slug.
 */
const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "auth",
  "account",
  "billing",
  "dashboard",
  "docs",
  "health",
  "help",
  "home",
  "login",
  "logout",
  "register",
  "settings",
  "signin",
  "signout",
  "signup",
  "support",
  "workspaces",
  "www",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

/**
 * Postgres schema identifier built from a workspace slug.
 *
 * Used by `provisionWorkspace` to derive the per-tenant schema name.
 * Hyphens become underscores so the identifier doesn't require quoting
 * in every SQL reference.
 */
export function workspaceSchemaName(slug: string): string {
  return `tenant_${slug.replace(/-/g, "_")}`;
}

/**
 * S3 key for a user's avatar.
 *
 * User-scoped (not workspace-scoped) because `users.image` is a single
 * global field — one image per user, not per workspace. The timestamp
 * suffix invalidates browser caches when the user uploads a new image.
 */
export function avatarS3Key(args: { userId: string; ext: string }): string {
  const ext = args.ext.replace(/^\./, "").toLowerCase();
  return `chat/users/${args.userId}/avatar-${Date.now()}.${ext}`;
}
