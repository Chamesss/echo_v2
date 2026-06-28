import { z } from "zod";

/**
 * Invite-form schema. Mirrors the backend (`members.dto.ts`): a valid email and
 * a role of admin/member. The server re-validates, so this is purely for fast
 * inline feedback.
 */
export const inviteSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  role: z.enum(["admin", "member"]),
});

export type InviteInput = z.infer<typeof inviteSchema>;
