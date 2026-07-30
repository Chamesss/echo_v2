import { useMutation, useQueryClient } from '@tanstack/react-query';
import { signOut } from '@/lib/auth-client';

/**
 * Mutation wrapper around Better Auth's `signOut`.
 *
 * Called by the sign-out button anywhere in the app shell. Clears the entire
 * React Query cache so the next user (or the same user signing in again)
 * doesn't see stale per-tenant data.
 *
 * The clear runs in `onSettled`, NOT `onSuccess`, and that ordering matters.
 * React Query runs the hook's `onSuccess` BEFORE the caller's, so clearing here
 * on success happened while the signed-in tree — the rail that owns the sign-out
 * button, with its `useMyWorkspaces` + `useNotificationsSummary` — was still
 * mounted, and the caller's `navigate(paths.login)` hadn't run yet. Dropping the
 * data made those live observers refetch instantly against a cookie that no
 * longer existed, and the resulting 401s fed the redirect loop documented in
 * `use-unauthorized-redirect`. `onSettled` fires after the caller's `onSuccess`,
 * so the redirect is already under way, and it also covers the failure path
 * (where the cache must still not outlive the session).
 */
export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const result = await signOut();
      if (result.error) {
        throw new Error(result.error.message ?? 'Sign out failed');
      }
      return result.data;
    },
    onSettled: () => {
      queryClient.clear();
    },
  });
}
