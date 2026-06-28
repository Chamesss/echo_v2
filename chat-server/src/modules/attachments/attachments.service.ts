import { randomUUID } from "node:crypto";
import { withTenantSchema } from "../../infrastructure/database/tenant/client.js";
import { s3Service } from "../../infrastructure/storage/s3-service.js";
import { BadRequestError } from "../../shared/errors/app-error.js";
import { ErrorCode } from "../../shared/errors/error-codes.js";
import { assertChannelMember } from "../channels/channels.service.js";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  validateUpload,
  type AttachmentCategory,
} from "./attachment-policy.js";
import type {
  AttachmentRef,
  PresignAttachmentBody,
} from "./attachments.dto.js";

/**
 * Attachment upload orchestration — the S3-facing half of the file manager.
 *
 * Flow: the client asks for a presigned PUT (`presignAttachment`, bound to the
 * declared type+size and scoped to a server-generated key), uploads the bytes
 * directly to S3, then posts the message with the keys. `resolveAttachmentsForSend`
 * is the trust boundary at send time: it re-checks ownership of each key, HEADs
 * the object for its REAL type/size (the client can't spoof metadata), and
 * re-validates against policy before the rows are persisted.
 *
 * Persistence of the rows lives with the message aggregate (`messages.service`),
 * which calls `resolveAttachmentsForSend` inside the send transaction.
 */

const EXT_RE = /\.([a-z0-9]{1,12})$/i;

function safeExt(filename: string): string {
  const m = EXT_RE.exec(filename.trim());
  return m ? m[1]!.toLowerCase() : "bin";
}

/**
 * Sanitize a client filename for display + Content-Disposition: replace path
 * separators, drop control characters and double-quotes (which would break the
 * quoted disposition header), trim, and cap length.
 */
function sanitizeFilename(filename: string): string {
  let out = "";
  for (const ch of filename.replace(/[/\\]/g, "_")) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || ch === '"') continue;
    out += ch;
  }
  out = out.trim().slice(0, 255);
  return out || "file";
}

/** Key prefix scoping an upload to a (workspace, channel, user). */
function keyPrefix(
  workspaceId: string,
  channelId: string,
  userId: string,
): string {
  return `chat/workspaces/${workspaceId}/channels/${channelId}/${userId}/`;
}

export interface PresignAttachmentResult {
  uploadUrl: string;
  key: string;
  publicUrl: string;
  requiredHeaders: Record<string, string>;
}

/** Mint a presigned PUT for a channel attachment (caller must be a channel member). */
export async function presignAttachment(
  workspaceId: string,
  channelId: string,
  userId: string,
  body: PresignAttachmentBody,
): Promise<PresignAttachmentResult> {
  await withTenantSchema(workspaceId, (db) =>
    assertChannelMember(db, channelId, userId),
  );

  const policy = validateUpload({
    contentType: body.contentType,
    contentLength: body.contentLength,
  });

  const key = `${keyPrefix(workspaceId, channelId, userId)}${randomUUID()}.${safeExt(body.filename)}`;
  // Non-inline/unknown types download instead of executing inline (XSS-safe).
  const contentDisposition = policy.forceDownload
    ? `attachment; filename="${sanitizeFilename(body.filename)}"`
    : undefined;

  const { uploadUrl, publicUrl, requiredHeaders } =
    await s3Service.createPresignedUploadUrl({
      key,
      contentType: body.contentType,
      contentLength: body.contentLength,
      contentDisposition,
    });
  return { uploadUrl, key, publicUrl, requiredHeaders };
}

export interface ResolvedAttachment {
  s3Key: string;
  url: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  category: AttachmentCategory;
}

/**
 * Verify + resolve attachment refs at send time (the trust boundary). For each:
 *   - the key MUST belong to this caller + channel (blocks referencing another
 *     user's/channel's object);
 *   - HeadObject confirms the object exists and yields its S3-authoritative
 *     type/size (no client spoofing);
 *   - that real type/size is re-validated against policy.
 * Returns rows ready to insert; throws on any failure so the send stays atomic.
 */
export async function resolveAttachmentsForSend(
  workspaceId: string,
  channelId: string,
  userId: string,
  refs: AttachmentRef[],
): Promise<ResolvedAttachment[]> {
  if (refs.length === 0) return [];
  if (refs.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new BadRequestError(
      `A message can have at most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments`,
      ErrorCode.TooManyAttachments,
    );
  }

  const prefix = keyPrefix(workspaceId, channelId, userId);
  const resolved: ResolvedAttachment[] = [];
  for (const ref of refs) {
    if (!ref.key.startsWith(prefix)) {
      throw new BadRequestError(
        "Invalid attachment reference",
        ErrorCode.InvalidAttachmentRef,
      );
    }
    const head = await s3Service.headObject(ref.key);
    if (!head) {
      throw new BadRequestError(
        "Attachment upload did not complete",
        ErrorCode.AttachmentUploadIncomplete,
      );
    }
    const policy = validateUpload({
      contentType: head.contentType,
      contentLength: head.contentLength,
    });
    resolved.push({
      s3Key: ref.key,
      url: s3Service.publicUrlFor(ref.key),
      filename: sanitizeFilename(ref.filename),
      contentType: head.contentType,
      sizeBytes: head.contentLength,
      category: policy.category,
    });
  }
  return resolved;
}
