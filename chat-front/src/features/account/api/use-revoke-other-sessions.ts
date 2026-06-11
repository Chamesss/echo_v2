import { useMutation } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";

/**
 * Mutation wrapper around Better Auth's `revokeOtherSessions`.
 *
 * Called by `SessionsCard` ("Sign out everywhere else"). Keeps the current
 * session alive — the caller doesn't get bounced. The next request from any
 * other device for this user will see 401 and trigger the unauthorized
 * redirect on that device.
 */
export function useRevokeOtherSessions() {
  return useMutation({
    mutationFn: async () => {
      const result = await authClient.revokeOtherSessions();
      if (result.error) {
        throw new Error(result.error.message ?? "Could not revoke sessions");
      }
      return result.data;
    },
  });
}
