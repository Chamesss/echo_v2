import { useMutation } from '@tanstack/react-query';
import { resetPassword } from '@/lib/auth-client';

/**
 * Mutation wrapper around Better Auth's `resetPassword`.
 *
 * Called by `ResetPasswordForm` once the user has clicked the reset link in
 * their email (which carries the `token` query param). On success the user
 * is signed out everywhere and must sign in again with the new password.
 */
export function useResetPassword() {
  return useMutation({
    mutationFn: async (input: { newPassword: string; token: string }) => {
      const result = await resetPassword({
        newPassword: input.newPassword,
        token: input.token,
      });
      if (result.error) {
        throw new Error(result.error.message ?? 'Password reset failed');
      }
      return result.data;
    },
  });
}
