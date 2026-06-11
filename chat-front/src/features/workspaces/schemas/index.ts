import { z } from "zod";

/**
 * Zod schemas for the workspaces module.
 *
 * Imported by `CreateWorkspaceForm` (via zodResolver) and by the create
 * mutation hook (for the input type). Slug rules match the backend's
 * validation in `chat-server/src/modules/workspaces/workspaces.dto.ts` so the
 * server can't reject a slug the form considered valid.
 */
export const createWorkspaceSchema = z.object({
  slug: z
    .string()
    .min(3, "At least 3 characters")
    .max(40, "At most 40 characters")
    .regex(
      /^[a-z][a-z0-9-]*$/,
      "Lowercase letters, numbers, and hyphens; must start with a letter",
    ),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
