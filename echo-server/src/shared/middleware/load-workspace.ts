import type { RequestHandler } from 'express';
import { and, eq } from 'drizzle-orm';
import { controlDb } from '../../infrastructure/database/control/client.js';
import { memberships, workspaces } from '../../infrastructure/database/control/schema.js';
import { ForbiddenError, NotFoundError } from '../errors/app-error.js';

declare global {
  namespace Express {
    interface Request {
      workspace: {
        id: string;
        slug: string;
        name: string;
        role: 'admin' | 'member';
        /** Whether the caller is the workspace owner (gates destructive actions). */
        isOwner: boolean;
      };
    }
  }
}

/**
 * Verifies the authenticated user is a member of the workspace named by
 * `req.params.workspaceId`, then attaches `req.workspace` for downstream
 * handlers and services.
 *
 * Mounted via `workspacesRouter.use('/:workspaceId', loadWorkspace)` so every
 * sub-route (`GET /:workspaceId`, the future channels and messages routers)
 * gets membership-checked uniformly. Must run AFTER `authenticate` — it
 * relies on `req.user.id`.
 *
 * Performance note: this hits the control plane on every request. The PK
 * (user_id, workspace_id) makes the lookup an index probe, but if it ever
 * shows up in profiles we can layer a per-process LRU on top of this without
 * touching call sites. Don't optimize speculatively.
 */
export const loadWorkspace: RequestHandler = async (req, _res, next) => {
  try {
    let workspaceId = req.params.workspaceId;
    if (!workspaceId) {
      throw new NotFoundError('Workspace not found in path', 'missing_workspace_id');
    }
    if (Array.isArray(workspaceId)) {
      workspaceId = workspaceId[0];
    }
    // Ensure workspaceId is a string
    if (typeof workspaceId !== 'string') {
      throw new NotFoundError('Workspace not found in path', 'invalid_workspace_id');
    }

    const [row] = await controlDb
      .select({
        id: workspaces.id,
        slug: workspaces.slug,
        name: workspaces.name,
        ownerId: workspaces.ownerId,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(
        and(
          eq(memberships.userId, req.user.id),
          eq(memberships.workspaceId, workspaceId as string),
        ),
      )
      .limit(1);

    if (!row) {
      throw new ForbiddenError('You are not a member of this workspace', 'not_a_member');
    }

    const { ownerId, ...workspace } = row;
    req.workspace = { ...workspace, isOwner: ownerId === req.user.id };
    next();
  } catch (err) {
    next(err);
  }
};
