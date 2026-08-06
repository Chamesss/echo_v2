import { eq, sql } from "drizzle-orm";
import { controlDb } from "../../infrastructure/database/control/client.js";
import {
  memberships,
  tenantCatalog,
  workspaces,
} from "../../infrastructure/database/control/schema.js";
import { clearTenantSchemaCache } from "../../infrastructure/database/tenant/client.js";
import {
  emitUserEvents,
  emitWorkspaceEvent,
  RealtimeEvents,
  UserEvents,
} from "../../infrastructure/realtime/events.js";
import { invalidateDirectory } from "../members/directory.service.js";
import {
  provisionWorkspace,
  type ProvisionWorkspaceResult,
} from "../../infrastructure/provisioning/workspace.js";
import { ConflictError } from "../../shared/errors/app-error.js";
import { isUniqueViolation } from "../../shared/errors/db-error.js";
import { ErrorCode } from "../../shared/errors/error-codes.js";
import type { CreateWorkspaceBody } from "./workspaces.dto.js";

/**
 * Creates a workspace owned by the given user and provisions its tenant schema.
 *
 * Called from `workspaces.controller.ts#createWorkspaceController` after the
 * `authenticate` middleware has already verified the user exists — that's why
 * this function trusts `ownerId` and doesn't re-check.
 *
 * Slug collisions surface from Postgres as SQLSTATE 23505. We catch that
 * specific case to produce a feature-friendly 409 with `code: slug_taken`
 * (so the form can highlight the slug field). Any OTHER DB error bubbles up
 * to the central error handler, which translates it via `db-error.ts` and
 * still returns a structured response — we don't need to know about every
 * possible failure mode here.
 */
export async function createWorkspace(
  ownerId: string,
  input: CreateWorkspaceBody,
): Promise<ProvisionWorkspaceResult> {
  try {
    return await provisionWorkspace({ slug: input.slug, ownerId });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(
        `Workspace slug "${input.slug}" is already taken`,
        ErrorCode.SlugTaken,
      );
    }
    throw err;
  }
}

/**
 * Returns every workspace the given user is a member of, with their role.
 *
 * Called from `workspaces.controller.ts#listMyWorkspacesController`, mounted
 * at `GET /api/workspaces`. The frontend calls this immediately after
 * sign-in to decide where to redirect — empty list goes to /workspaces/create,
 * non-empty to /dashboard/:id.
 */
export async function listMyWorkspaces(userId: string) {
  const rows = await controlDb
    .select({
      id: workspaces.id,
      slug: workspaces.slug,
      name: workspaces.name,
      ownerId: workspaces.ownerId,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId));
  return rows.map(({ ownerId, ...w }) => ({ ...w, isOwner: ownerId === userId }));
}

/** Rename a workspace's display name (the slug is immutable). */
export async function renameWorkspace(workspaceId: string, name: string) {
  const [row] = await controlDb
    .update(workspaces)
    .set({ name })
    .where(eq(workspaces.id, workspaceId))
    .returning({ id: workspaces.id, slug: workspaces.slug, name: workspaces.name });
  // Live clients re-read the workspace (name shown in the rail/switcher/header).
  await emitWorkspaceEvent(workspaceId, RealtimeEvents.workspaceUpdated());
  return row!; // existence already guaranteed by loadWorkspace
}

/**
 * Permanently delete a workspace and tear down its tenant schema.
 *
 * One transaction: DROP the `tenant_<slug>` schema (taking channels, messages,
 * and members with it), then delete the control row — which cascades to
 * `memberships`, `tenant_catalog`, and `invite_tokens` via their FKs. Audit
 * rows in `auth_events` survive (workspaceId lives in their JSON metadata, not
 * a FK). Finally drop the workspace from the in-process schema + directory
 * caches so nothing keeps pointing at a dead schema.
 */
export async function deleteWorkspace(workspaceId: string): Promise<void> {
  const [catalog] = await controlDb
    .select({ schemaName: tenantCatalog.schemaName })
    .from(tenantCatalog)
    .where(eq(tenantCatalog.workspaceId, workspaceId))
    .limit(1);

  // Capture the member set BEFORE the cascade drops `memberships`, so we can
  // bounce everyone out — even members sitting on the dashboard or in another
  // workspace — over their always-on user socket (dual-route).
  const members = await controlDb
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.workspaceId, workspaceId));

  await controlDb.transaction(async (tx) => {
    if (catalog) {
      await tx.execute(sql`DROP SCHEMA IF EXISTS ${sql.identifier(catalog.schemaName)} CASCADE`);
    }
    await tx.delete(workspaces).where(eq(workspaces.id, workspaceId));
  });

  clearTenantSchemaCache(workspaceId);
  invalidateDirectory(workspaceId);
  await emitUserEvents(
    members.map((m) => ({ userId: m.userId, event: UserEvents.workspaceDeleted(workspaceId) })),
  );
}

