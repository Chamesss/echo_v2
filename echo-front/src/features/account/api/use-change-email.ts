import { useMutation } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import type { ChangeEmailInput } from "../schemas";

/**
 * Mutation wrapper around Better Auth's `changeEmail`.
 *
 * Called by `ChangeEmailForm`. Better Auth sends a confirmation email to
 * the CURRENT email address (the one we know belongs to the user). The
 * swap to `newEmail` only happens after the user clicks the link in that
 * email — defense against an attacker who has the session cookie but not
 * the inbox.
 */
export function useChangeEmail() {
  return useMutation({
    mutationFn: async (input: ChangeEmailInput) => {
      const result = await authClient.changeEmail({ newEmail: input.newEmail });
      if (result.error) {
        throw new Error(result.error.message ?? "Could not request email change");
      }
      return result.data;
    },
  });
}
