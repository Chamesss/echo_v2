import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";

export const sessionsKey = ["sessions"] as const;

/**
 * Lists every active session for the current user.
 *
 * Used by `SessionsCard` to render the device list. Includes the CURRENT
 * session — components highlight it via the matching session token.
 */
export function useSessions() {
  return useQuery({
    queryKey: sessionsKey,
    queryFn: async () => {
      const result = await authClient.listSessions();
      if (result.error) {
        throw new Error(result.error.message ?? "Could not load sessions");
      }
      return result.data;
    },
  });
}

/**
 * Revokes one specific session (by token).
 *
 * Used by per-row "Sign out" buttons in `SessionsCard`. The next request
 * from that device returns 401, which triggers `useUnauthorizedRedirect`
 * and bounces them to /login.
 *
 * Invalidates the list on success so the row disappears.
 */
export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) => {
      const result = await authClient.revokeSession({ token });
      if (result.error) {
        throw new Error(result.error.message ?? "Could not revoke session");
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionsKey });
    },
  });
}

/**
 * Revokes every session EXCEPT the current one.
 *
 * Used by the "Sign out everywhere else" button. Cheaper than iterating
 * `revokeSession` per row and gives the user a single action.
 */
export function useRevokeOtherSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const result = await authClient.revokeOtherSessions();
      if (result.error) {
        throw new Error(result.error.message ?? "Could not revoke sessions");
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionsKey });
    },
  });
}
