/**
 * Promote a user to the global "admin" role by email.
 *
 * Usage:  pnpm db:make-admin you@example.com
 *
 * This is the bootstrap path for the /admin dashboard: the dashboard gates on
 * `users.role === 'admin'`, and there's no one to click "make admin" until the
 * first admin exists — so we set it directly here. After that, admins promote
 * others from the UI. (The `ADMIN_USER_IDS` env list is a separate server-side
 * override; this script sets the durable role column the UI reads.)
 */
import { eq } from "drizzle-orm";
import { controlDb } from "../infrastructure/database/control/client.js";
import { users } from "../infrastructure/database/control/schema.js";

const email = process.argv[2]?.trim();

if (!email) {
  console.error("Usage: pnpm db:make-admin <email>");
  process.exit(1);
}

const [updated] = await controlDb
  .update(users)
  .set({ role: "admin" })
  .where(eq(users.email, email))
  .returning({ id: users.id, email: users.email, role: users.role });

if (!updated) {
  console.error(`✗ No user found with email "${email}". Sign up first, then re-run.`);
  process.exit(1);
}

console.log(`✓ ${updated.email} is now "${updated.role}" (id: ${updated.id})`);
process.exit(0);
