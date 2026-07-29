import { useMutation, useQueryClient } from '@tanstack/react-query';
import { signOut } from '@/lib/auth-client';

/**
 * Mutation wrapper around Better Auth's `signOut`.
 *
 * Called by the sign-out button anywhere in the app shell. Clears the entire
 * React Query cache on success so the next user (or the same user signing in
 * again) doesn't see stale per-tenant data.
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
    onSuccess: () => {
      queryClient.clear();
    },
  });
}
