import { z } from "zod";

/**
 * Request shapes for the attachments concern. Per-category size/type policy is
 * enforced in `attachments.service` (it depends on the resolved category), not
 * here — these schemas only guard structural validity.
 */

/** Body for POST …/channels/:channelId/attachments/presign. */
export const presignAttachmentBody = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(255),
  contentLength: z.number().int().positive(),
});
export type PresignAttachmentBody = z.infer<typeof presignAttachmentBody>;

/** A reference to an already-uploaded object, sent back when posting a message. */
export const attachmentRef = z.object({
  key: z.string().min(1).max(512),
  filename: z.string().trim().min(1).max(255),
});
export type AttachmentRef = z.infer<typeof attachmentRef>;
