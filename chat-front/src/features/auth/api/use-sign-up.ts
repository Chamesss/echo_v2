import { useMutation } from '@tanstack/react-query';
import { signUp } from '@/lib/auth-client';
import { captchaRequestOptions } from '../components/Captcha';
import type { SignUpInput } from '../schemas';

/**
 * Mutation wrapper around Better Auth's `signUp.email`.
 *
 * Called by `SignUpForm`. On success Better Auth automatically signs the user
 * in (cookie set) so the form can navigate straight to `/` instead of
 * bouncing through `/login`.
 *
 * `captchaToken` is the Turnstile token (null when CAPTCHA is disabled),
 * forwarded as the `x-captcha-response` header rather than in the body.
 */
export function useSignUp() {
  return useMutation({
    mutationFn: async ({
      captchaToken,
      ...input
    }: SignUpInput & { captchaToken: string | null }) => {
      const result = await signUp.email({
        ...input,
        ...captchaRequestOptions(captchaToken),
      });
      if (result.error) {
        throw new Error(result.error.message ?? 'Sign up failed');
      }
      return result.data;
    },
  });
}
