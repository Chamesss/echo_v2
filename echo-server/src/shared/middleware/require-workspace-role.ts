import type { RequestHandler } from "express";
import { ForbiddenError } from "../errors/app-error.js";
import { ErrorCode } from "../errors/error-codes.js";

type WorkspaceRole = "admin" | "member";

/**
 * Route guard on the caller's WORKSPACE role.
 *
 * Must run AFTER `loadWorkspace`, which verifies membership and attaches
 * `req.workspace.role`. Membership is therefore already guaranteed by the time
 * this runs — this only narrows access to the allowed role(s). Governance
 * actions (rename/delete workspace, manage members, delete/rename channels)
 * mount it as `requireWorkspaceRole("admin")`:
 *
 *   workspacesRouter.delete("/:workspaceId", requireWorkspaceRole("admin"), …)
 *
 * Per the permission matrix (docs/MVP-SCOPE), members may create channels,
 * post, and join public channels without this guard; admin-only mutations wear
 * it explicitly.
 */
export function requireWorkspaceRole(...allowed: WorkspaceRole[]): RequestHandler {
  return (req, _res, next) => {
    const role = req.workspace?.role;
    if (!role) {
      // Defensive: a missing workspace context means the route wasn't mounted
      // behind `loadWorkspace`. Fail closed rather than leak access.
      return next(new ForbiddenError("Workspace context missing", ErrorCode.Forbidden));
    }
    if (!allowed.includes(role)) {
      return next(
        new ForbiddenError(
          `This action requires workspace role: ${allowed.join(" or ")}`,
          ErrorCode.InsufficientWorkspaceRole,
        ),
      );
    }
    next();
  };
}
