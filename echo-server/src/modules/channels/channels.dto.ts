import { z } from "zod";
import { attachmentRef } from "../attachments/attachments.dto.js";

/**
 * Request shapes for the channels + messages module. Passed to `validate(...)`
 * in `channels.routes.ts`; controllers read the inferred types.
 *
 * v1 creates named channels only (`public` / `private`); `direct` / `group`
 * arrive with the DMs follow-up. Message bodies are length-capped so a full
 * event envelope stays under Postgres NOTIFY's 8 KB payload limit (see
 * `realtime/backplane.ts`).
 */
export const MAX_MESSAGE_LENGTH = 4000;

export const createChannelBody = z.object({
  type: z.enum(["public", "private"]),
  name: z.string().trim().min(1).max(80),
});
export type CreateChannelBody = z.infer<typeof createChannelBody>;

/**
 * Channel update (rename / set topic / archive). All fields optional, but at
 * least one must be present — an empty PATCH is a 400, not a silent no-op.
 * `topic` accepts an empty string to clear it.
 *
 * `name` accepts null to CLEAR it, which only makes sense for a group
 * conversation: it has no name of its own by default and falls back to a label
 * built from who's in it, so clearing is how you get that default back. A named
 * channel can't be left nameless — the service rejects null for those types.
 */
export const updateChannelBody = z
  .object({
    name: z.string().trim().min(1).max(80).nullable().optional(),
    topic: z.string().trim().max(280).optional(),
    archived: z.boolean().optional(),
  })
  .refine((b) => b.name !== undefined || b.topic !== undefined || b.archived !== undefined, {
    message: "Provide at least one of name, topic, or archived",
  });
export type UpdateChannelBody = z.infer<typeof updateChannelBody>;

export const addChannelMemberBody = z.object({
  userId: z.string().min(1),
});
export type AddChannelMemberBody = z.infer<typeof addChannelMemberBody>;

/** Open-or-create a DM with these other users (1 = direct, 2+ = group). */
export const openDmBody = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(9),
});
export type OpenDmBody = z.infer<typeof openDmBody>;


export const sendMessageBody = z
  .object({
    // Client-generated idempotency key (optimistic UI + safe retries).
    clientId: z.string().uuid(),
    // Optional when there's at least one attachment (file-only messages). The
    // refine below enforces "text OR ≥1 attachment". Structural max only; the
    // per-message count cap is enforced server-side in resolveAttachmentsForSend.
    body: z.string().trim().max(MAX_MESSAGE_LENGTH).default(""),
    attachments: z.array(attachmentRef).max(50).default([]),
  })
  .refine((b) => b.body.length > 0 || b.attachments.length > 0, {
    message: "A message needs text or at least one attachment",
  });
export type SendMessageBody = z.infer<typeof sendMessageBody>;

export const editMessageBody = z.object({
  body: z.string().trim().max(MAX_MESSAGE_LENGTH).default(""),
  // Existing attachment ids to KEEP. Omitted (undefined) → attachments are left
  // untouched (a plain text edit preserves them). Provided (even empty) → the
  // server reconciles the message's attachments to exactly this set. The final
  // message can't be empty (text or ≥1 attachment) — enforced server-side.
  keepAttachmentIds: z.array(z.string().uuid()).optional(),
  attachments: z.array(attachmentRef).max(50).default([]),
});
export type EditMessageBody = z.infer<typeof editMessageBody>;


export const markReadBody = z.object({
  seq: z.number().int().nonnegative(),
});
export type MarkReadBody = z.infer<typeof markReadBody>;

// Catch-up (`since`) + history paging (`before`) share one query schema.
export const listMessagesQuery = z.object({
  since: z.coerce.number().int().nonnegative().optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuery>;
