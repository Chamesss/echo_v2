import "dotenv/config";
import { z } from "zod";

/**
 * Environment variable schema & loader.
 *
 * Parsed once at import time. Importing `env` anywhere in the app gives you
 * typed, validated values — and a clear startup-time crash if a required
 * variable is missing, instead of a vague runtime failure deep in a request.
 *
 * Optional vars (Google OAuth, email, S3) are accepted as undefined. The
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
  /**
   * Ceiling on any single statement. Tunable because it also bounds waiting on a
   * row lock: a channel's writers serialize, so a burst's last writer waits
   * ~(writers × round-trip). Raise it for a distant database, not to paper over
   * a slow query.
   */
  DB_STATEMENT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .default(15_000),
  BETTER_AUTH_SECRET: z
    .string()
    .min(8, "BETTER_AUTH_SECRET must be at least 8 characters"),
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
  // PUBLIC Turnstile site key. Served to the SPA at runtime (injected into
  // index.html by app.ts) so the widget renders without a rebuild — unlike the
  // frontend's build-time VITE_TURNSTILE_SITE_KEY. Pair with the secret above:
  // set BOTH or NEITHER, or email auth breaks (server requires a token the
  // widget can't produce).
  TURNSTILE_SITE_KEY: z.string().optional(),
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
  // Resend API key (resend.com → API Keys). When set, Resend is THE email
  // transport and every SMTP_* var below is ignored. Optional — unset, the
  // service falls back to SMTP, then to logging (see email-service.ts).
  RESEND_API_KEY: z.string().optional(),
  // Default from address for outgoing mail, e.g. "Echo <no-reply@domain.com>".
  // On Resend the sending domain must be verified in the dashboard or every
  // send is rejected — use "onboarding@resend.dev" to send without a domain
  // (delivers only to your own Resend account address).
  EMAIL_FROM: z.string().optional(),
  // SMTP fallback, used only when RESEND_API_KEY is absent. Handy for local
  // Mailtrap sandboxes and self-hosters who'd rather not add a SaaS provider.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // From address for the SMTP transport only, overriding EMAIL_FROM. Lets the
  // two transports send as different addresses — Resend needs a verified
  // domain, an SMTP relay wants the mailbox it authenticated as — so switching
  // between them doesn't mean editing EMAIL_FROM each time. Falls back to
  // EMAIL_FROM when unset.
  SMTP_FROM: z.string().optional(),
  AWS_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AVATAR_MAX_SIZE_MB: z.coerce.number().int().min(1).max(50).default(5),
  // Per-category message-attachment size caps (MB) + count cap per message.
  // Drive the attachment policy (modules/attachments/attachment-policy.ts) so
  // limits are tunable per deploy without code changes.
  ATTACH_IMAGE_MAX_MB: z.coerce.number().int().min(1).max(2000).default(25),
  ATTACH_VIDEO_MAX_MB: z.coerce.number().int().min(1).max(2000).default(200),
  ATTACH_AUDIO_MAX_MB: z.coerce.number().int().min(1).max(2000).default(50),
  ATTACH_DOC_MAX_MB: z.coerce.number().int().min(1).max(2000).default(50),
  ATTACH_FILE_MAX_MB: z.coerce.number().int().min(1).max(2000).default(50),
  ATTACH_MAX_PER_MESSAGE: z.coerce.number().int().min(1).max(50).default(10),
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
