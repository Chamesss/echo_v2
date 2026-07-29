import { eq } from "drizzle-orm";
import { controlDb } from "../../infrastructure/database/control/client.js";
import { memberships, users } from "../../infrastructure/database/control/schema.js";

/**
 * Workspace member directory: a lightweight `userId → { name, image }` map used
 * to put author names/avatars on messages without joining the users table on
 * every message read (Sprint 5's hot path).
 *
 * Cached in-process with a short TTL and explicitly invalidated when the member
 * set changes (add/remove/leave/accept), so a busy channel render is cheap and
 * a new member shows up immediately rather than after the TTL.
 *
 * Scope note: this resolves CURRENT members. A message from someone who has
 * since left won't be in the map and falls back to a generic label on the
 * client — acceptable for the MVP; broaden to resolve arbitrary author ids if
 * historical-author fidelity becomes a requirement.
 */

export interface DirectoryProfile {
  name: string;
  image: string | null;
}

export type Directory = Record<string, DirectoryProfile>;

interface CacheEntry {
  value: Directory;
  expiresAt: number;
}

const TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export async function getDirectory(workspaceId: string): Promise<Directory> {
  const hit = cache.get(workspaceId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const rows = await controlDb
    .select({ id: users.id, name: users.name, image: users.image })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.workspaceId, workspaceId));

  const directory: Directory = {};
  for (const r of rows) directory[r.id] = { name: r.name, image: r.image ?? null };

  cache.set(workspaceId, { value: directory, expiresAt: Date.now() + TTL_MS });
  return directory;
}

/** Drop a workspace's cached directory (call when its member set changes). */
export function invalidateDirectory(workspaceId?: string): void {
  if (workspaceId) cache.delete(workspaceId);
  else cache.clear();
}
