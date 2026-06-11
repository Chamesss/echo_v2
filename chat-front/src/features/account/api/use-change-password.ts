import { useMutation } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import type { ChangePasswordInput } from "../schemas";

/**
 * Mutation wrapper around Better Auth's `changePassword`.
 *
 * Called by `ChangePasswordForm`. Better Auth verifies `currentPassword`
 * server-side before applying the change; a wrong current password surfaces
 * as an error and the form shows it as a toast.
 *
 * `revokeOtherSessions: true` (default in the form) signs the user out of
 * every other device on success — the right move for a password change.
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: ChangePasswordInput) => {
      const result = await authClient.changePassword({
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        revokeOtherSessions: input.revokeOtherSessions,
      });
      if (result.error) {
        throw new Error(result.error.message ?? "Could not change password");
      }
      return result.data;
    },
  });
}
