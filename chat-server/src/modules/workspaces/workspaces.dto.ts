import { z } from 'zod';

/**
 * Request/response shapes for the workspaces module.
 *
 * Imported by `workspaces.routes.ts` (passed to `validate(...)`) and by
 * `workspaces.controller.ts` for its inferred TS type. Owning the schemas
 * here keeps request-shape decisions next to the feature they describe.
 *
 * Note: `ownerId` is intentionally absent from `createWorkspaceBody` — the
 * owner is always the authenticated caller (`req.user.id`). Accepting it in
 * the body would let any caller create workspaces owned by other users.
 */
export const createWorkspaceBody = z.object({
  slug: z
    .string()
    .min(3)
    .max(40)
    .regex(
      /^[a-z][a-z0-9-]*$/,
      'Slug must be lowercase alphanumeric with hyphens, starting with a letter',
    ),
});

export type CreateWorkspaceBody = z.infer<typeof createWorkspaceBody>;
