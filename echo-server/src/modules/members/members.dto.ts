import { z } from "zod";

/**
 * Request shapes for membership + invitations. Emails are trimmed + lowercased
 * so storage and lookups are case-insensitive and stable.
 */

const role = z.enum(["admin", "member"]);
const email = z.string().trim().toLowerCase().email();

export const addMemberBody = z.object({ email, role: role.default("member") });
export type AddMemberBody = z.infer<typeof addMemberBody>;

export const changeRoleBody = z.object({ role });
export type ChangeRoleBody = z.infer<typeof changeRoleBody>;

export const createInviteBody = z.object({ email, role: role.default("member") });
export type CreateInviteBody = z.infer<typeof createInviteBody>;
