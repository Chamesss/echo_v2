import { eq } from "drizzle-orm";
import { controlDb } from "../../infrastructure/database/control/client.js";
import { memberships, workspaces } from "../../infrastructure/database/control/schema.js";
import {
  provisionWorkspace,
  type ProvisionWorkspaceResult,
} from "../../infrastructure/provisioning/workspace.js";
import { ConflictError } from "../../shared/errors/app-error.js";
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
  return controlDb
    .select({
      id: workspaces.id,
      slug: workspaces.slug,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId));
}

/**
 * Narrow check for SQLSTATE 23505 (unique_violation).
 *
 * Used ONLY by `createWorkspace` to override the generic message the
 * database-error translator would produce. New callers should usually let
 * the translator do its job rather than copy this pattern — feature-specific
 * messages are worth the override only when the UI needs to react to the
 * exact failure mode (here: highlighting the slug field inline).
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "23505"
  );
}
