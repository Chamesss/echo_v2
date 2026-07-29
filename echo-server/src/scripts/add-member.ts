/**
 * Add an existing user to a workspace (dev helper).
 *
 * Usage:  bun run db:add-member <workspace-slug> <user-email> [role]
 *   role defaults to "member"; pass "admin" for a workspace admin.
 *
 * Stand-in for the not-yet-built invite flow — useful for testing multi-user
 * chat: have the second person sign up first (creates their `users` row), then
 * run this to drop them into the workspace. They'll see it after sign-in and can
 * join its public channels.
 */
import { eq } from "drizzle-orm";
import { controlDb } from "../infrastructure/database/control/client.js";
import { memberships, users, workspaces } from "../infrastructure/database/control/schema.js";
import { pool } from "../infrastructure/database/pool.js";

const slug = process.argv[2]?.trim();
const email = process.argv[3]?.trim();
const role = (process.argv[4]?.trim() ?? "member") as "admin" | "member";

if (!slug || !email) {
  console.error("Usage: bun run db:add-member <workspace-slug> <user-email> [admin|member]");
  process.exit(1);
}
if (role !== "admin" && role !== "member") {
  console.error(`Invalid role "${role}" — must be "admin" or "member".`);
  process.exit(1);
}

const [workspace] = await controlDb
  .select({ id: workspaces.id })
  .from(workspaces)
  .where(eq(workspaces.slug, slug))
  .limit(1);
if (!workspace) {
  console.error(`✗ No workspace with slug "${slug}".`);
  await pool.end();
  process.exit(1);
}

const [user] = await controlDb
  .select({ id: users.id })
  .from(users)
  .where(eq(users.email, email))
  .limit(1);
if (!user) {
  console.error(`✗ No user with email "${email}". Have them sign up first, then re-run.`);
  await pool.end();
  process.exit(1);
}

await controlDb
  .insert(memberships)
  .values({ userId: user.id, workspaceId: workspace.id, role })
  .onConflictDoUpdate({
    target: [memberships.userId, memberships.workspaceId],
    set: { role },
  });

console.log(`✓ ${email} is now a "${role}" of workspace "${slug}".`);
await pool.end();
