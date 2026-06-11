import { s3Service } from "../../infrastructure/storage/s3-service.js";
import { avatarS3Key } from "../../shared/slug/index.js";
import { BadRequestError } from "../../shared/errors/app-error.js";
import { extensionFor, type PresignAvatarBody } from "./users.dto.js";

/**
 * Creates a presigned S3 PUT URL for the caller's avatar.
 *
 * Called from `users.controller.ts#presignAvatarController`. Flow:
 *   1. Validate the requested contentType + size (handled upstream by the
 *      DTO; we trust it here)
 *   2. Build the S3 key from the user id + an extension + a timestamp
 *   3. Ask the S3 service for a time-limited PUT URL bound to that exact
 *      contentType and size
 *   4. Return `{ uploadUrl, publicUrl, key }`
 *
 * The frontend then PUTs the file directly to `uploadUrl` (no proxying
 * through our server) and calls `authClient.updateUser({ image: publicUrl })`
 * to persist the URL on the user row.
 *
 * If S3 isn't configured the service throws — `NotConfiguredError` from
 * the S3 layer surfaces as a `BadRequestError` here so the controller
 * returns 400 rather than crashing.
 */
export async function createAvatarUpload(
  userId: string,
  input: PresignAvatarBody,
): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
  if (!s3Service.isConfigured()) {
    throw new BadRequestError(
      "Avatar uploads are not enabled on this server",
      "uploads_not_configured",
    );
  }

  const key = avatarS3Key({
    userId,
    ext: extensionFor(input.contentType),
  });

  return s3Service.createPresignedUploadUrl({
    key,
    contentType: input.contentType,
    contentLength: input.contentLength,
  });
}
