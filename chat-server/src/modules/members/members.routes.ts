import { Router } from "express";
import { asyncHandler } from "../../shared/middleware/async-handler.js";
import { validate } from "../../shared/middleware/validate.js";
import { requireWorkspaceRole } from "../../shared/middleware/require-workspace-role.js";
import { addMemberBody, changeRoleBody } from "./members.dto.js";
import {
  addMemberController,
  changeRoleController,
  listMembersController,
  removeMemberController,
} from "./members.controller.js";

/**
 * Member roster, mounted at `/api/workspaces/:workspaceId/members`.
 * Parent ran `authenticate` + `loadWorkspace`, so membership is guaranteed.
 * Listing is member-level; all mutations are admin-only.
 *
 *   GET    /                 list members (with role + profile)
 *   POST   /                 admin: add an existing user by email
 *   PATCH  /:userId          admin: change a member's role
 *   DELETE /:userId          admin: remove a member
 */
export const membersRouter = Router({ mergeParams: true });

membersRouter.get("/", asyncHandler(listMembersController));
membersRouter.post(
  "/",
  requireWorkspaceRole("admin"),
  validate({ body: addMemberBody }),
  asyncHandler(addMemberController),
);
membersRouter.patch(
  "/:userId",
  requireWorkspaceRole("admin"),
  validate({ body: changeRoleBody }),
  asyncHandler(changeRoleController),
);
membersRouter.delete("/:userId", requireWorkspaceRole("admin"), asyncHandler(removeMemberController));
