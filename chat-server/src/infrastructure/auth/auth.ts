import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  openAPI,
  twoFactor,
  haveIBeenPwned,
  captcha,
  admin,
} from "better-auth/plugins";
import { controlDb } from "../database/control/client.js";
import * as schema from "../database/control/schema.js";
import { emailService } from "../email/email-service.js";
import { AuthEventName, logAuthEvent } from "../audit/audit-log.js";
import { announceProfileUpdate } from "../../modules/members/members.service.js";
import { env, corsOrigins, adminUserIds } from "../../config/env.js";

/**
 * The Better Auth instance.
 *
 * Consumers:
 *   - `modules/auth/auth.routes.ts` mounts `auth.handler` at /api/auth/*
 *   - `shared/middleware/authenticate.ts` calls `auth.api.getSession(...)`
 *   - `shared/openapi/document.ts` calls `auth.api.generateOpenAPISchema()`
 *   - The frontend imports `AuthInstance` (the type below) to infer its
 *     Better Auth client's API surface from this exact config.
 *
 * Schema mapping: Better Auth's internal names (`user`, `session`, `account`,
 * `verification`, `twoFactor`) are mapped to our pluralized Drizzle tables.
 *
 * Social providers are each registered only when their own credentials are
 * present in env (per-provider gating, see `oauthProvider` below), so an
 * unconfigured local environment still boots and an unconfigured provider's
 * button just 400s if clicked.
 *
 * Feature flags surfaced from env:
 *   - AUTH_DISABLE_SIGNUP             → invite-only (sign-in still works)
 *   - AUTH_REQUIRE_EMAIL_VERIFICATION → gate accounts behind verification email
 *   - AUTH_SESSION_EXPIRES_DAYS       → session lifetime in days
 *
 * Cookie hardening:
 *   - httpOnly      → cookie not readable by JS (CSRF/XSS defense)
 *   - secure        → HTTPS-only in production (auto-off in dev for localhost)
 *   - sameSite=lax  → blocks cross-site POSTs while allowing top-level nav
 *   - (no cookieCache) → every session check hits the DB, so a revoked/expired
 *                        session is rejected immediately everywhere (see the
 *                        `session` block below for the full reasoning)
 *
 * Robustness layers:
 *   - rateLimit       → brute-force defense on auth endpoints
 *   - accountLinking  → Google auto-merges onto an existing email/password row
 *                       only when that local email is verified; otherwise the
 *                       user links Google manually from Account settings (see
 *                       the `account.accountLinking` block for the full why)
 *   - twoFactor       → optional TOTP layer; users opt-in from /account
 *   - haveIBeenPwned  → rejects passwords found in known breach corpora
 *   - captcha         → Cloudflare Turnstile gate on sign-up/sign-in/reset,
 *                       only active when TURNSTILE_SECRET_KEY is set
 *   - changeEmail     → confirmation flow to the OLD email before swap
 *   - deleteUser      → user-initiated account deletion (cascades through FKs)
 *   - databaseHooks   → audit trail in `auth_events` for security-relevant ops
 *   - sendResetPassword / sendVerificationEmail / sendChangeEmailConfirmation
 *                     → delegate to `emailService` (SMTP in prod, console log
 *                       in dev for testing)
 */
// Build an OAuth provider entry only when BOTH credentials are present;
// otherwise return `undefined`. Better Auth drops `undefined`/`null` provider
// configs (create-context.ts: `if (config == null) return null`), so each
// provider is gated independently — an unconfigured one just isn't registered
// and its button 400s on click, while the rest of the app boots fine.
const oauthProvider = (clientId?: string, clientSecret?: string) =>
  clientId && clientSecret ? { clientId, clientSecret } : undefined;

// To add a provider, touch three small places:
//   1. config/env.ts          → add FOO_CLIENT_ID / FOO_CLIENT_SECRET (optional)
//   2. here                    → add one `foo: oauthProvider(...)` line
//   3. chat-front/.../auth/social-providers.tsx → add its button (label + icon)
// Then decide deliberately whether it earns a spot in `trustedProviders` below
// (that governs silent account auto-linking — a security choice, not automatic).
const socialProviders = {
  google: oauthProvider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
  github: oauthProvider(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
};

const isProduction = env.NODE_ENV === "production";

// CAPTCHA is registered only when a Turnstile secret is present — same
// graceful-degradation pattern as socialProviders above. Without it, the
// captcha onRequest hook is never added and the auth endpoints behave as
// before, so local dev without keys still works. The plugin reads the token
// from the `x-captcha-response` header and verifies it server-side against
// Cloudflare, guarding /sign-up/email, /sign-in/email, and
// /request-password-reset by default.
const captchaPlugin = env.TURNSTILE_SECRET_KEY
  ? captcha({
      provider: "cloudflare-turnstile",
      secretKey: env.TURNSTILE_SECRET_KEY,
    })
  : undefined;

export const auth = betterAuth({
  database: drizzleAdapter(controlDb, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      twoFactor: schema.twoFactors,
    },
  }),

  emailAndPassword: {
    enabled: true,
    disableSignUp: env.AUTH_DISABLE_SIGNUP,
    requireEmailVerification: env.AUTH_REQUIRE_EMAIL_VERIFICATION,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user, url }) => {
      await emailService.sendResetPassword({
        to: user.email,
        name: user.name,
        url,
      });
      await logAuthEvent({
        userId: user.id,
        event: AuthEventName.PasswordResetRequested,
      });
    },
  },

  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await emailService.sendVerificationEmail({
        to: user.email,
        name: user.name,
        url,
      });
    },
    sendOnSignUp: env.AUTH_REQUIRE_EMAIL_VERIFICATION,
    autoSignInAfterVerification: true,
  },

  socialProviders,

  account: {
    accountLinking: {
      enabled: true,
      // Google verifies emails it issues, so we trust its email_verified
      // claim as proof of ownership when linking to an existing local row.
      trustedProviders: ["google", "github"],
      // Keep Better Auth's default guard ON (it defaults to true; we set it
      // explicitly to document the decision). It blocks AUTOMATIC linking of a
      // social login onto a local (email/password) account whose own email was
      // never verified — the pre-registration account-takeover vector: an
      // attacker signs up victim@example.com with a password they control, and
      // if we auto-linked, the victim's later Google sign-in would ride on the
      // attacker's row. So when an unverified local account collides with a
      // Google sign-in, Better Auth emits `account_not_linked` instead of
      // merging. That is intentional, not a failure.
      //
      // Recovery path (no security trade-off): the user signs in with their
      // existing email/password — which PROVES they own the local account —
      // then links Google explicitly from Account settings → Connected
      // accounts (authClient.linkSocial). That manual flow runs under an
      // authenticated session, so the ownership check the verification guard
      // would have done is already satisfied. The frontend surfaces the
      // `account_not_linked` redirect as a friendly "sign in, then connect
      // Google in Settings" notice on /login.
      requireLocalEmailVerified: true,
    },
  },

  user: {
    changeEmail: {
      enabled: true,
      // Send confirmation to the CURRENT email; only after the user clicks
      // the link does Better Auth swap the address. Prevents session-theft
      // attackers from silently rerouting account recovery.
      sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
        await emailService.sendChangeEmailConfirmation({
          to: user.email,
          name: user.name,
          newEmail,
          url,
        });
        await logAuthEvent({
          userId: user.id,
          event: AuthEventName.EmailChangeRequested,
          metadata: { newEmail },
        });
      },
    },
    deleteUser: {
      enabled: true,
      // No `sendDeleteAccountVerification` — Better Auth deletes immediately
      // after the password check (which the `deleteUser` endpoint enforces
      // because the user has a credential account).
      beforeDelete: async (user) => {
        await logAuthEvent({
          userId: user.id,
          event: AuthEventName.AccountDeleted,
          metadata: { email: user.email },
        });
      },
    },
  },

  session: {
    expiresIn: env.AUTH_SESSION_EXPIRES_DAYS * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
    // cookieCache is intentionally OFF. A signed client-side session cache
    // keeps `getSession` returning a "valid" session for up to maxAge after the
    // session is revoked/expired server-side. That desynced the frontend
    // (useSession → "logged in") from the API (authenticate → 401) and produced
    // a redirect loop for revoked sessions: the 401 handler pushed to /login
    // while RedirectIfAuthed saw the cached session and pushed back into the
    // app. With no cache, every check is DB-truth and revocation takes effect
    // on the next focus / navigation / API call. Re-enable only with an
    // explicit cache-invalidation-on-revoke strategy.
  },

  advanced: {
    // Behind Render/Railway's TLS-terminating proxy the real client IP arrives in
    // `X-Forwarded-For`; without this Better Auth can't resolve an IP and all
    // requests fall into ONE shared rate-limit bucket (the startup warning). Read
    // the forwarded header so rate limiting buckets per-client.
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for"],
    },
    defaultCookieAttributes: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
    },
  },

  rateLimit: {
    window: 10,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60 * 60, max: 3 },
      "/request-password-reset": { window: 60 * 60, max: 3 },
      "/two-factor/verify-totp": { window: 60, max: 10 },
    },
  },

  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          await logAuthEvent({
            userId: session.userId,
            event: AuthEventName.SessionCreated,
            ipAddress: session.ipAddress ?? null,
            userAgent: session.userAgent ?? null,
          });
        },
      },
    },
    user: {
      create: {
        after: async (user) => {
          await logAuthEvent({
            userId: user.id,
            event: AuthEventName.UserCreated,
            metadata: { email: user.email },
          });
        },
      },
      update: {
        // A name/avatar change → refresh the directory in every workspace this
        // user belongs to so author names/avatars update live (best-effort).
        after: async (user) => {
          await announceProfileUpdate(user.id);
        },
      },
    },
  },

  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: corsOrigins,
  plugins: [
    openAPI(),
    twoFactor({
      issuer: "Chat",
    }),
    // Blocks passwords found in the Have I Been Pwned breach corpus. Uses a
    // k-anonymity range query, so only a SHA-1 prefix is sent to HIBP — the
    // password itself never leaves the server. Checks /sign-up/email,
    // /change-password, and /reset-password by default.
    haveIBeenPwned({
      customPasswordCompromisedMessage:
        "This password has appeared in a known data breach. Please choose a different one.",
    }),
    // Spread in only when configured (see captchaPlugin above).
    ...(captchaPlugin ? [captchaPlugin] : []),
    // Admin plugin — powers the /admin dashboard (list/ban/role/impersonate/
    // session management). It adds the `role`, `banned`, `banReason`,
    // `banExpires` columns to `users` and `impersonatedBy` to `sessions`
    // (mapped in schema.ts) and exposes the `/admin/*` endpoints.
    //
    // Who is an admin: a user whose `role` is in `adminRoles`, OR whose id is
    // in `adminUserIds` (the env bootstrap list). The env list is the escape
    // hatch that lets the very first admin in before anyone can be promoted via
    // the dashboard; everyone else is governed by the `role` column.
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
      adminUserIds,
    }),
  ],
});

/**
 * Type of the Better Auth instance.
 *
 * Imported by `chat-front/src/lib/auth-client.ts` via the `@server/*` path
 * alias so the React client's API surface is inferred from this exact config
 * (the right endpoint names, the right user fields, the right plugins —
 * including `twoFactor`).
 */
export type AuthInstance = typeof auth;

export type Session = typeof auth.$Infer.Session;
