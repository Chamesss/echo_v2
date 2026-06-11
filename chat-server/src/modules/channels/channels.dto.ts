import { z } from "zod";

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

export const channelParams = z.object({
  workspaceId: z.string().uuid(),
  channelId: z.string().uuid(),
});

export const sendMessageBody = z.object({
  // Client-generated idempotency key (optimistic UI + safe retries).
  clientId: z.string().uuid(),
  body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});
export type SendMessageBody = z.infer<typeof sendMessageBody>;

export const editMessageBody = z.object({
  body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});
export type EditMessageBody = z.infer<typeof editMessageBody>;

export const messageIdParams = z.object({
  workspaceId: z.string().uuid(),
  channelId: z.string().uuid(),
  messageId: z.string().uuid(),
});

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
