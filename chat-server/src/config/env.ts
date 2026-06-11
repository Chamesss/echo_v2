import "dotenv/config";
import { z } from "zod";

/**
 * Environment variable schema & loader.
 *
 * Parsed once at import time. Importing `env` anywhere in the app gives you
 * typed, validated values — and a clear startup-time crash if a required
 * variable is missing, instead of a vague runtime failure deep in a request.
 *
 * Optional vars (Google OAuth, SMTP, S3) are accepted as undefined. The
 * downstream consumers (`auth.ts`, `email-service.ts`, `s3-service.ts`)
 * check presence and degrade gracefully (no Google button, NoOp email
 * service, 501 on avatar upload).
 *
 * `AUTH_*` flags toggle Better Auth behavior without code changes — useful
 * for flipping invite-only mode or email verification per environment.
 */
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z
    .string()
    .min(8, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url(),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  // Cloudflare Turnstile secret. When set, the captcha plugin (auth.ts) gates
  // sign-up / sign-in / password-reset on a valid token. Optional so an
  // unconfigured dev environment still boots — same pattern as Google OAuth.
  TURNSTILE_SECRET_KEY: z.string().optional(),
  AUTH_DISABLE_SIGNUP: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  AUTH_REQUIRE_EMAIL_VERIFICATION: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  AUTH_SESSION_EXPIRES_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  // Comma-separated user IDs that are always treated as admins, regardless of
  // their `users.role` column. Bootstraps the first admin for the /admin
  // dashboard (the admin plugin in auth.ts) so you're not stuck with no one
  // able to promote anyone. Empty by default — no implicit admins.
  ADMIN_USER_IDS: z.string().default(""),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  AWS_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AVATAR_MAX_SIZE_MB: z.coerce.number().int().min(1).max(50).default(5),
});

export const env = schema.parse(process.env);

/**
 * Parsed list of allowed CORS origins.
 *
 * Used by `app.ts` for the cors middleware and by `auth.ts` for Better Auth's
 * `trustedOrigins` (which validates the Origin header on auth requests).
 */
export const corsOrigins = env.CORS_ORIGINS.split(",")
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * Parsed list of bootstrap admin user IDs.
 *
 * Passed to the `admin` plugin's `adminUserIds` in `auth.ts`. Users in this
 * list always pass admin checks; everyone else is gated by their `users.role`.
 */
export const adminUserIds = env.ADMIN_USER_IDS.split(",")
  .map((id) => id.trim())
  .filter(Boolean);
