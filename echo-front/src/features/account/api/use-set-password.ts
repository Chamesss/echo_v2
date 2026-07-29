import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { linkedAccountsKey } from "./use-linked-accounts";
import type { SetPasswordInput } from "../schemas";

/**
 * Sets a first password for an account that signed up through a social provider
 * and has none.
 *
 * This goes to our own API rather than `authClient` because Better Auth's
 * `setPassword` is server-only by design (no HTTP route) — see
 * `echo-server/src/modules/users/users.service.ts`. Changing an EXISTING
 * password still goes through `useChangePassword`, which verifies the current
 * one.
 *
 * On success the linked-accounts query is invalidated: the user now has a
 * `credential` account, which flips both `ConnectedAccounts` ("Email & password
 * — Enabled") and `PasswordSection` (over to the change-password form).
 */
export function useSetPassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SetPasswordInput) => {
      await apiFetch<void>("/api/users/me/password", {
        method: "POST",
        body: { newPassword: input.newPassword },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: linkedAccountsKey });
    },
  });
}
