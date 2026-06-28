/**
 * Reset all conversations + channels, keeping workspaces and members.
 *
 * Usage:
 *   pnpm db:reset-conversations --yes                 # every workspace
 *   pnpm db:reset-conversations --yes --workspace=<workspaceId>
 *
 * For each tenant schema it TRUNCATEs the conversation tables — `attachments`,
 * `message_revisions`, `messages`, `channel_members`, `channels` (this wipes
 * named channels AND direct/group DMs and resets every channel's `last_seq`
 * clock). It then clears the control-plane notification state — `notifications`
 * (inbox rows, which reference channels that no longer exist) and
 * `notification_settings` (per-workspace prefs) — for a fully clean slate.
 *
 * DELIBERATELY KEPT: `workspaces`, `users`, `memberships` (members), and the
 * tenant schemas / `tenant_catalog` mapping. Everything conversation- and
 * notification-related is reset. DESTRUCTIVE + irreversible — requires `--yes`.
 */
import { eq, sql, asc } from "drizzle-orm";
import { controlDb } from "../infrastructure/database/control/client.js";
import {
  notificationSettings,
  notifications,
  tenantCatalog,
} from "../infrastructure/database/control/schema.js";
import { pool } from "../infrastructure/database/pool.js";

// CASCADE-safe order isn't required (all referencing tables are listed), but
// CASCADE is kept as belt-and-suspenders. Nothing outside this set references
// these tables within a tenant schema.
const TENANT_TABLES = [
  "attachments",
  "message_revisions",
  "messages",
  "channel_members",
  "channels",
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const confirmed = args.includes("--yes") || args.includes("-y");
  const workspaceId = args
    .find((a) => a.startsWith("--workspace="))
    ?.split("=")[1];

  if (!confirmed) {
    console.error(
      "Refusing to run without --yes.\n" +
        "This DELETES all channels, DMs, messages, attachments, and notifications.\n" +
        "Workspaces, members, users, and notification settings are kept.\n\n" +
        "Run:  pnpm db:reset-conversations --yes  [--workspace=<workspaceId>]",
    );
    await pool.end();
    process.exit(1);
  }

  const tenants = await controlDb
    .select()
    .from(tenantCatalog)
    .orderBy(asc(tenantCatalog.schemaName));

  const targets = workspaceId
    ? tenants.filter((t) => t.workspaceId === workspaceId)
    : tenants;

  if (targets.length === 0) {
    console.log(
      workspaceId
        ? `No tenant found for workspace ${workspaceId}.`
        : "No tenants found.",
    );
    await pool.end();
    return;
  }

  console.log(`Resetting conversations for ${targets.length} workspace(s)…`);

  for (const tenant of targets) {
    await controlDb.transaction(async (tx) => {
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.identifier(tenant.schemaName)}`,
      );
      await tx.execute(
        sql.raw(`TRUNCATE TABLE ${TENANT_TABLES.join(", ")} CASCADE`),
      );
      await tx.execute(sql`SET LOCAL search_path TO public`);
    });
    console.log(
      `  ✓ ${tenant.schemaName}: channels, DMs, messages, attachments cleared`,
    );
  }

  // Notification state lives in the control plane — clear the inbox rows (they
  // point at channels we just wiped) and the per-workspace prefs. Scoped to the
  // workspace when one was given.
  const deletedNotifs = await (
    workspaceId
      ? controlDb
          .delete(notifications)
          .where(eq(notifications.workspaceId, workspaceId))
      : controlDb.delete(notifications)
  ).returning({ id: notifications.id });
  console.log(`  ✓ notifications cleared (${deletedNotifs.length} row(s))`);

  const deletedSettings = await (
    workspaceId
      ? controlDb
          .delete(notificationSettings)
          .where(eq(notificationSettings.workspaceId, workspaceId))
      : controlDb.delete(notificationSettings)
  ).returning({ userId: notificationSettings.userId });
  console.log(
    `  ✓ notification settings cleared (${deletedSettings.length} row(s))`,
  );

  console.log("Done.");
  await pool.end();
}

main().catch(async (err) => {
  console.error("✗ Reset failed:", err);
  await pool.end();
  process.exit(1);
});
