import { z } from "zod";
import { openApiRegistry } from "../../shared/openapi/registry.js";
import { presignAvatarBody, setPasswordBody } from "./users.dto.js";

/**
 * OpenAPI registrations for the users module.
 *
 * Imported as a side-effect by `shared/openapi/document.ts`. Request schemas
 * come from `users.dto.ts` (same shape used at runtime); response shapes
 * live here.
 */

const presignAvatarResponseSchema = z
  .object({
    uploadUrl: z.string().url(),
    publicUrl: z.string().url(),
    key: z.string(),
  })
  .openapi("PresignAvatarResponse");

const errorBodySchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
    }),
  })
  .openapi("UsersErrorBody");

openApiRegistry.register("PresignAvatarBody", presignAvatarBody);

openApiRegistry.registerPath({
  method: "post",
  path: "/api/users/me/avatar",
  tags: ["Users"],
  summary: "Create a presigned upload URL for the caller's avatar",
  description:
    "Returns a time-limited S3 PUT URL the browser can upload to directly. " +
    "After upload, the caller updates `user.image` via Better Auth's " +
    "`updateUser` endpoint using the returned `publicUrl`.",
  security: [{ sessionCookie: [] }],
  request: {
    body: {
      content: { "application/json": { schema: presignAvatarBody } },
    },
  },
  responses: {
    200: {
      description: "Presigned upload URL",
      content: { "application/json": { schema: presignAvatarResponseSchema } },
    },
    400: {
      description: "Invalid body or S3 not configured on this server",
      content: { "application/json": { schema: errorBodySchema } },
    },
    401: {
      description: "Not authenticated",
      content: { "application/json": { schema: errorBodySchema } },
    },
  },
});

openApiRegistry.register("SetPasswordBody", setPasswordBody);

openApiRegistry.registerPath({
  method: "post",
  path: "/api/users/me/password",
  tags: ["Users"],
  summary: "Set a first password for a social-only account",
  description:
    "For users who signed up through an OAuth provider and have no password " +
    "yet, so no current password is required. Rejected if the account already " +
    "has one — changing an existing password goes through Better Auth's " +
    "`/api/auth/change-password`, which verifies the current password.",
  security: [{ sessionCookie: [] }],
  request: {
    body: {
      content: { "application/json": { schema: setPasswordBody } },
    },
  },
  responses: {
    204: { description: "Password set" },
    400: {
      description: "Password too short/long, or the account already has one",
      content: { "application/json": { schema: errorBodySchema } },
    },
    401: {
      description: "Not authenticated",
      content: { "application/json": { schema: errorBodySchema } },
    },
  },
});
