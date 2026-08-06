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
 * The Better Auth instance. The frontend infers its client's API surface from
 * `AuthInstance` (below), so this config is a shared contract.
 *
 * Two decisions worth knowing before editing: there is deliberately NO
 * cookieCache (see the `session` block), and account linking is conditional
 * (see `account.accountLinking`). Everything else reads off the keys.
 */
// Both credentials or nothing: Better Auth drops `undefined` provider configs
// (`if (config == null) return null`), so each provider gates independently —
// an unconfigured one just 400s on click instead of breaking boot.
const oauthProvider = (clientId?: string, clientSecret?: string) =>
  clientId && clientSecret ? { clientId, clientSecret } : undefined;

// To add a provider, touch three small places:
//   1. config/env.ts          → add FOO_CLIENT_ID / FOO_CLIENT_SECRET (optional)
//   2. here                    → add one `foo: oauthProvider(...)` line
//   3. echo-front/.../auth/social-providers.tsx → add its button (label + icon)
// Then decide deliberately whether it earns a spot in `trustedProviders` below
// (that governs silent account auto-linking — a security choice, not automatic).
const socialProviders = {
  google: oauthProvider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
  github: oauthProvider(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
};

const isProduction = env.NODE_ENV === "production";

// Registered only with a Turnstile secret present, so dev without keys works.
// Reads `x-captcha-response`; guards sign-up, sign-in and password reset.
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
      // Blocks the pre-registration takeover vector: an attacker signs up
      // victim@example.com, and auto-linking would put the victim's later Google
      // sign-in on the attacker's row. An unverified collision therefore emits
      // `account_not_linked` — intentional, not a failure.
      //
      // Recovery costs no security: signing in with the existing password proves
      // ownership, after which Google links manually from Account settings.
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
    freshAge: 0,
    // cookieCache intentionally OFF: a cached session stays "valid" after
    // server-side revocation, which desynced useSession from the API and caused
    // a redirect loop (401 → /login → RedirectIfAuthed → back in). Re-enable
    // only with cache-invalidation-on-revoke.
  },

  advanced: {
    // Without this, no IP resolves behind the proxy and every request shares ONE
    // rate-limit bucket.
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
      "/sign-in/email": { window: 60, max: 20 },
      "/sign-up/email": { window: 60 * 60, max: 20 },
      "/request-password-reset": { window: 60 * 60, max: 20 },
      "/two-factor/verify-totp": { window: 60, max: 20 },
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
      issuer: "Echo",
    }),
    // k-anonymity range query: only a SHA-1 prefix ever leaves the server.
    haveIBeenPwned({
      customPasswordCompromisedMessage:
        "This password has appeared in a known data breach. Please choose a different one.",
    }),
    // Spread in only when configured (see captchaPlugin above).
    ...(captchaPlugin ? [captchaPlugin] : []),
    // Admin = `role` in `adminRoles` OR id in `adminUserIds`. The env list is
    // the bootstrap hatch for the first admin, before anyone can be promoted
    // from the dashboard.
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
      adminUserIds,
    }),
  ],
});

/** Imported by the frontend so its client infers this exact config. */
export type AuthInstance = typeof auth;

export type Session = typeof auth.$Infer.Session;
