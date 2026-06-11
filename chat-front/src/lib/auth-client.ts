import { createAuthClient } from "better-auth/react";
import {
  inferAdditionalFields,
  twoFactorClient,
  adminClient,
} from "better-auth/client/plugins";
import type { AuthInstance } from "@server/infrastructure/auth/auth";
import { env } from "@/config/env";

/**
 * Better Auth client instance — the frontend's gateway to /api/auth/*.
 *
 * Exposes hooks (`useSession`) and methods (`signIn`, `signUp`, `signOut`,
 * `requestPasswordReset`, `resetPassword`, `changeEmail`, `deleteUser`,
 * `twoFactor.*`, `listSessions`, etc.) used across the auth + account
 * features.
 *
 * The client manages session cookies for us; `apiFetch` in `api.ts` carries
 * those cookies on every other request via `credentials: 'include'`.
 *
 * Type inference: `inferAdditionalFields<AuthInstance>()` reads the server's
 * Better Auth config type (imported as a type-only reference from
 * `@server/infrastructure/auth/auth`) so the client knows exactly which
 * endpoints, fields, and provider options the server actually exposes.
 *
 * `twoFactorClient()` matches the server's `twoFactor` plugin so the typed
 * surface exposes `authClient.twoFactor.{enable,verifyTotp,disable,...}` and
 * the sign-in flow knows about the 2FA challenge response shape.
 *
 * `adminClient()` matches the server's `admin` plugin, exposing
 * `authClient.admin.{listUsers,setRole,banUser,unbanUser,impersonateUser,
 * stopImpersonating,listUserSessions,revokeUserSession,...}` used by the
 * /admin dashboard.
 */
export const authClient = createAuthClient({
  baseURL: env.VITE_API_URL,
  plugins: [
    inferAdditionalFields<AuthInstance>(),
    twoFactorClient(),
    adminClient(),
  ],
});

export const {
  useSession,
  signIn,
  signUp,
  signOut,
  requestPasswordReset,
  resetPassword,
} = authClient;
