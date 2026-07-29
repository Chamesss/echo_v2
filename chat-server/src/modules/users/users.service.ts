import type { IncomingHttpHeaders } from "node:http";
import { fromNodeHeaders } from "better-auth/node";
import { s3Service } from "../../infrastructure/storage/s3-service.js";
import { auth } from "../../infrastructure/auth/auth.js";
import { AuthEventName, logAuthEvent } from "../../infrastructure/audit/audit-log.js";
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

/**
 * Sets a first password for a user who signed up through a social provider and
 * therefore has no credential account.
 *
 * Better Auth implements this as `setPassword`, but registers it WITHOUT an HTTP
 * path — it is reachable from `auth.api` only, deliberately, so a stolen session
 * cookie can't mint a password straight from the browser. This route is that
 * server-side door, and it stays narrow: Better Auth still owns the hashing and
 * still refuses (`PASSWORD_ALREADY_SET`) if a credential account exists, so this
 * can only ever add a missing password, never overwrite one. Changing an
 * existing password keeps going through `/change-password` with the current one.
 *
 * Called from `users.controller.ts#setPasswordController`. Headers are forwarded
 * so Better Auth resolves the session itself rather than trusting a user id.
 */
export async function setInitialPassword(
  userId: string,
  headers: IncomingHttpHeaders,
  input: { newPassword: string },
): Promise<void> {
  try {
    await auth.api.setPassword({
      body: { newPassword: input.newPassword },
      headers: fromNodeHeaders(headers),
    });
  } catch (err) {
    // Better Auth throws its own APIError; the one case worth translating is
    // "you already have a password", which is a client mistake, not a 500.
    const message = err instanceof Error ? err.message : "Could not set password";
    throw new BadRequestError(message, "set_password_failed");
  }

  await logAuthEvent({ userId, event: AuthEventName.PasswordChanged });
}
