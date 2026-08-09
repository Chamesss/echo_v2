/**
 * Seed a showcase workspace and print its PUBLIC invite link (dev/ops helper).
 *
 * Usage:  bun run db:seed-showcase <workspace-slug> <owner-email> [admin|member] [display name]
 *   role defaults to "member" — what everyone following the link becomes.
 *   display name defaults to the slug; it's the mutable label shown in the UI
 *   (editable later in workspace settings), so put whatever you like here.
 *
 * The link is reusable, addressed to nobody, and dated year 9999 so it never
 * expires: paste it anywhere, and anyone who signs up through it lands in the
 * workspace. It reuses the ordinary `/accept-invite/:token` page — see
 * `PUBLIC_INVITE_EMAIL` in invites.service.ts for why the sentinel is safe.
 *
 * Re-running ROTATES the link: the old row is deleted, so previously shared
 * copies stop working. That's also how you revoke one. People who already
 * joined keep their membership.
 *
 * Only the token's SHA-256 hash is stored, so the URL below is printed once and
 * cannot be recovered later — save it, or re-run to mint a new one.
 */
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { corsOrigins } from "../config/env.js";
import { controlDb } from "../infrastructure/database/control/client.js";
import { inviteTokens, users, workspaces } from "../infrastructure/database/control/schema.js";
import { pool } from "../infrastructure/database/pool.js";
import { provisionWorkspace } from "../infrastructure/provisioning/workspace.js";
import { hashToken, PUBLIC_INVITE_EMAIL } from "../modules/members/invites.service.js";

const slug = process.argv[2]?.trim();
const ownerEmail = process.argv[3]?.trim();
const role = (process.argv[4]?.trim() ?? "member") as "admin" | "member";
const displayName = process.argv[5]?.trim() || slug;

if (!slug || !ownerEmail) {
  console.error(
    "Usage: bun run db:seed-showcase <workspace-slug> <owner-email> [admin|member] [display name]",
  );
  process.exit(1);
}
if (role !== "admin" && role !== "member") {
  console.error(`Invalid role "${role}" — must be "admin" or "member".`);
  process.exit(1);
}

/** Exit with a message, closing the pool so the process doesn't hang. */
async function fail(message: string): Promise<never> {
  console.error(message);
  await pool.end();
  process.exit(1);
}

const [owner] = await controlDb
  .select({ id: users.id })
  .from(users)
  .where(eq(users.email, ownerEmail))
  .limit(1);
if (!owner) {
  await fail(`✗ No user with email "${ownerEmail}". Have them sign up first, then re-run.`);
}

// Reuse the workspace if the slug already exists, so re-running to rotate the
// link doesn't need a fresh slug (and can't half-create anything).
const [existing] = await controlDb
  .select({ id: workspaces.id })
  .from(workspaces)
  .where(eq(workspaces.slug, slug))
  .limit(1);

let workspaceId: string;
if (existing) {
  workspaceId = existing.id;
  console.log(`• Workspace "${slug}" already exists — reusing it.`);
} else {
  // Provisions the control row, the owner's admin membership, and the tenant
  // schema in one transaction.
  ({ workspaceId } = await provisionWorkspace({ slug, ownerId: owner!.id }));
  console.log(`✓ Created workspace "${slug}" owned by ${ownerEmail}.`);
}

// `provisionWorkspace` defaults the display name to the slug; set the friendlier
// label when one was given. Applied on reuse too, so a re-run can rename.
if (displayName !== slug) {
  await controlDb.update(workspaces).set({ name: displayName }).where(eq(workspaces.id, workspaceId));
  console.log(`• Display name set to "${displayName}".`);
}

// One live public link per workspace: drop any previous one first, which is
// what makes a re-run a rotation rather than a second valid link.
const rotated = await controlDb
  .delete(inviteTokens)
  .where(
    and(eq(inviteTokens.workspaceId, workspaceId), eq(inviteTokens.email, PUBLIC_INVITE_EMAIL)),
  )
  .returning({ id: inviteTokens.id });

const token = crypto.randomBytes(32).toString("base64url");
await controlDb.insert(inviteTokens).values({
  workspaceId,
  email: PUBLIC_INVITE_EMAIL,
  role,
  tokenHash: hashToken(token),
  invitedBy: owner!.id,
  expiresAt: new Date("9999-12-31T23:59:59.000Z"),
});

const base = (corsOrigins[0] ?? "http://localhost:3000").replace(/\/$/, "");
if (rotated.length) console.log("• Rotated the previous link — old copies no longer work.");
console.log(`\n✓ Public showcase link (joins as "${role}", never expires):\n`);
console.log(`  ${base}/accept-invite/${token}\n`);
console.log("  Save it — only its hash is stored, so it can't be shown again.");

await pool.end();
