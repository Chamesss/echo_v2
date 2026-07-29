import { useMutation } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";

/**
 * Mutations + queries for the Better Auth `twoFactor` plugin.
 *
 * Used by `TwoFactorSection` in account settings AND by `SignInForm` (for
 * the verify-totp step during sign-in when 2FA is enabled).
 *
 * The plugin endpoints:
 *   - `enable({ password, issuer? })`  → { totpURI, backupCodes }
 *   - `verifyTotp({ code, trustDevice? })`
 *   - `disable({ password })`
 *   - `getTotpUri({ password })`       (re-display the URI if needed)
 *   - `generateBackupCodes({ password })`
 *
 * `enable` returns the otpauth:// URI (encode into a QR code) and a list of
 * one-time backup codes that the user must save. The session refetches
 * automatically when `verifyTotp` confirms setup is complete, flipping
 * `user.twoFactorEnabled` to true everywhere `useSession()` is consumed.
 */
export function useEnableTwoFactor() {
  return useMutation({
    mutationFn: async (input: { password: string }) => {
      const result = await authClient.twoFactor.enable({ password: input.password });
      if (result.error) {
        throw new Error(result.error.message ?? "Could not enable two-factor");
      }
      return result.data;
    },
  });
}

export function useVerifyTotp() {
  return useMutation({
    mutationFn: async (input: { code: string; trustDevice?: boolean }) => {
      const result = await authClient.twoFactor.verifyTotp({
        code: input.code,
        trustDevice: input.trustDevice ?? false,
      });
      if (result.error) {
        throw new Error(result.error.message ?? "Code is invalid or expired");
      }
      return result.data;
    },
  });
}

export function useDisableTwoFactor() {
  return useMutation({
    mutationFn: async (input: { password: string }) => {
      const result = await authClient.twoFactor.disable({ password: input.password });
      if (result.error) {
        throw new Error(result.error.message ?? "Could not disable two-factor");
      }
      return result.data;
    },
  });
}
