import { z } from "zod";
import { finalizeSlugInput, SLUG_MAX_LENGTH } from "../utils/normalize-slug-input";

/**
 * Zod schemas for the workspaces module.
 *
 * Imported by `CreateWorkspaceForm` (via zodResolver) and by the create
 * mutation hook (for the input type). Slug rules match the backend's
 * validation in `chat-server/src/modules/workspaces/workspaces.dto.ts` so the
 * server can't reject a slug the form considered valid.
 *
 * The preprocess step trims surrounding whitespace and drops the trailing
 * hyphen the live normalizer leaves behind, so the checks below run against the
 * exact string that gets submitted. It matters for the Enter-to-submit path:
 * the field's `onBlur` tidying never fires there, so without this a trailing
 * space would ship "acme-corp-" as the permanent workspace URL.
 *
 * Interior spaces still fail the regex. The form converts them to hyphens as
 * you type (`normalizeSlugInput`), so seeing that message means the value
 * arrived some way other than the keyboard.
 */
export const createWorkspaceSchema = z.object({
  slug: z.preprocess(
    (value) => (typeof value === "string" ? finalizeSlugInput(value.trim()) : value),
    z
      .string()
      .min(3, "At least 3 characters")
      .max(SLUG_MAX_LENGTH, `At most ${SLUG_MAX_LENGTH} characters`)
      .regex(
        /^[a-z][a-z0-9-]*$/,
        "Lowercase letters, numbers, and hyphens only — no spaces; must start with a letter",
      ),
  ),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

/** Workspace rename (display name only — the slug is immutable). */
export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "At most 80 characters"),
});

export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
