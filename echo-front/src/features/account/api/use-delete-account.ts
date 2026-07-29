import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import type { DeleteAccountInput } from "../schemas";

/**
 * Mutation wrapper around Better Auth's `deleteUser`.
 *
 * Called by `DangerZone`. Requires the user's password (Better Auth's
 * deleteUser endpoint enforces this when the user has a credential
 * account). On success the user row is deleted; cascading FKs handle
 * sessions, accounts, memberships. Workspace ownership uses `onDelete:
 * restrict` so deleting a sole workspace owner will surface as an error —
 * users have to transfer ownership before account deletion succeeds.
 *
 * On success we clear the entire RQ cache so the next render shows a
 * pristine logged-out state.
 */
export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DeleteAccountInput) => {
      const result = await authClient.deleteUser({ password: input.password });
      if (result.error) {
        throw new Error(result.error.message ?? "Could not delete account");
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.clear();
    },
  });
}
