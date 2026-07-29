import { useMutation } from "@tanstack/react-query";
import { requestPasswordReset } from "@/lib/auth-client";
import { captchaRequestOptions } from "../components/Captcha";
import type { ForgotPasswordInput } from "../schemas";

/**
 * Mutation wrapper around Better Auth's `requestPasswordReset`.
 *
 * Called by `ForgotPasswordForm`. The `redirectTo` URL is where Better Auth
 * sends the user after they click the reset link in their email — that route
 * (`/reset-password?token=...`) reads the token from the query string and
 * calls `useResetPassword`.
 *
 * Returns success even if the email doesn't exist (Better Auth's default,
 * which is the right privacy-preserving behavior — don't leak which addresses
 * are registered).
 */
export function useForgotPassword() {
  return useMutation({
    mutationFn: async ({
      captchaToken,
      ...input
    }: ForgotPasswordInput & { captchaToken: string | null }) => {
      const result = await requestPasswordReset({
        email: input.email,
        redirectTo: `${window.location.origin}/reset-password`,
        ...captchaRequestOptions(captchaToken),
      });
      if (result.error) {
        throw new Error(result.error.message ?? "Could not send reset email");
      }
      return result.data;
    },
  });
}
