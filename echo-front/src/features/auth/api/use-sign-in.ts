import { useMutation } from '@tanstack/react-query';
import { signIn } from '@/lib/auth-client';
import { captchaRequestOptions } from '../components/Captcha';
import type { SignInInput } from '../schemas';

/**
 * Mutation wrapper around Better Auth's `signIn.email`.
 *
 * Called by `SignInForm`. Better Auth returns `{ data, error }`; we throw on
 * `error` so React Query's `onError` callback fires and the form can show a
 * toast. On success the session cookie is set automatically — the next
 * `useSession()` consumer will see the new session after a refetch.
 *
 * `captchaToken` is the Turnstile token (null when CAPTCHA is disabled); it's
 * forwarded as the `x-captcha-response` header via `captchaRequestOptions` and
 * never sent in the request body.
 */
export function useSignIn() {
  return useMutation({
    mutationFn: async ({
      captchaToken,
      ...input
    }: SignInInput & { captchaToken: string | null }) => {
      const result = await signIn.email({
        ...input,
        ...captchaRequestOptions(captchaToken),
      });
      if (result.error) {
        throw new Error(result.error.message ?? 'Sign in failed');
      }
      return result.data;
    },
  });
}
