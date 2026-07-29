import { z } from "zod";
import { openApiRegistry } from "../../shared/openapi/registry.js";
import { appearancePreferences, updatePreferencesBody } from "./preferences.dto.js";

/**
 * OpenAPI registrations for the preferences module.
 *
 * Imported as a side-effect by `shared/openapi/document.ts`. Request schemas
 * come from `preferences.dto.ts` (same shape used at runtime).
 */

const preferencesResponseSchema = z
  .object({ preferences: appearancePreferences })
  .openapi("PreferencesResponse");

const errorBodySchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
    }),
  })
  .openapi("PreferencesErrorBody");

openApiRegistry.register("UpdatePreferencesBody", updatePreferencesBody);

openApiRegistry.registerPath({
  method: "get",
  path: "/api/preferences",
  tags: ["Preferences"],
  summary: "Get the caller's UI preferences",
  description:
    "Returns appearance preferences with defaults filled in for anything the " +
    "user hasn't set. Never 404s — a user with no stored row gets the defaults.",
  security: [{ sessionCookie: [] }],
  responses: {
    200: {
      description: "The caller's preferences",
      content: { "application/json": { schema: preferencesResponseSchema } },
    },
    401: {
      description: "Not authenticated",
      content: { "application/json": { schema: errorBodySchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: "put",
  path: "/api/preferences",
  tags: ["Preferences"],
  summary: "Update the caller's UI preferences",
  description:
    "Accepts a PARTIAL payload — send only the fields being changed. Omitted " +
    "fields keep their stored value, so an older client cannot blank out a " +
    "preference it doesn't know about. Returns the full resulting payload.",
  security: [{ sessionCookie: [] }],
  request: {
    body: {
      content: { "application/json": { schema: updatePreferencesBody } },
    },
  },
  responses: {
    200: {
      description: "The full preferences after the patch was applied",
      content: { "application/json": { schema: preferencesResponseSchema } },
    },
    400: {
      description: "Invalid body (unknown theme id, empty patch, …)",
      content: { "application/json": { schema: errorBodySchema } },
    },
    401: {
      description: "Not authenticated",
      content: { "application/json": { schema: errorBodySchema } },
    },
  },
});
