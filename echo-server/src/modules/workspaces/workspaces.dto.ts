import { z } from 'zod';
import { isReservedSlug } from '../../shared/slug/index.js';

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
    .trim()
    .min(3)
    .max(40)
    .regex(
      /^[a-z][a-z0-9-]*$/,
      'Slug must be lowercase alphanumeric with hyphens, no spaces, starting with a letter',
    )
    // Would shadow a system route (`/admin`, `/api`, `/settings`, …).
    .refine((slug) => !isReservedSlug(slug), 'That slug is reserved'),
});

export type CreateWorkspaceBody = z.infer<typeof createWorkspaceBody>;

/**
 * Rename a workspace's display name. The slug is immutable (it backs the tenant
 * schema name), so only `name` is editable.
 */
export const updateWorkspaceBody = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
});

export type UpdateWorkspaceBody = z.infer<typeof updateWorkspaceBody>;
