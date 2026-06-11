import { z } from "zod";
import { env } from "../../config/env.js";

/**
 * Allowed MIME types for avatar uploads.
 *
 * Restricted to widely-supported web image formats. SVG is intentionally
 * excluded — it can carry script payloads and the browser would execute
 * them when the avatar URL is opened in a new tab.
 */
const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const maxBytes = env.AVATAR_MAX_SIZE_MB * 1024 * 1024;

/**
 * Body for POST /api/users/me/avatar — caller declares the file shape so
 * the backend can mint a presigned URL bound to those exact constraints.
 *
 * Imported by `users.routes.ts` (via `validate(...)`), `users.controller.ts`
 * (for the inferred type), and `users.openapi.ts` (for the docs schema).
 */
export const presignAvatarBody = z.object({
  contentType: z.enum(ALLOWED_AVATAR_TYPES, {
    message: `contentType must be one of: ${ALLOWED_AVATAR_TYPES.join(", ")}`,
  }),
  contentLength: z
    .number()
    .int()
    .positive()
    .max(maxBytes, `File must be under ${env.AVATAR_MAX_SIZE_MB} MB`),
});

export type PresignAvatarBody = z.infer<typeof presignAvatarBody>;

/**
 * Maps a MIME type to its canonical file extension.
 *
 * Used by `users.service.ts` to build the S3 key. Keeping the map here
 * (next to the validation that whitelists the types) prevents an
 * out-of-sync state where the DTO accepts a type the service can't name.
 */
export function extensionFor(contentType: (typeof ALLOWED_AVATAR_TYPES)[number]): string {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
  }
}
