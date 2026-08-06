import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authClient } from '@/lib/auth-client';
import type { ProviderId } from '@/features/auth/social-providers';

export const linkedAccountsKey = ['linked-accounts'] as const;

/**
 * Lists the providers linked to the current user (Better Auth `/list-accounts`).
 *
 * Each row has a `providerId`: `"credential"` is the email/password login, and
 * social ids like `"google"` / `"github"` are linked OAuth accounts.
 * `ConnectedAccounts` uses this to show which sign-in methods are active and
 * which providers can be connected or disconnected.
 */
export function useLinkedAccounts() {
  return useQuery({
    queryKey: linkedAccountsKey,
    queryFn: async () => {
      const result = await authClient.listAccounts();
      if (result.error) {
        throw new Error(result.error.message ?? 'Could not load connected accounts');
      }
      return result.data;
    },
  });
}

/**
 * Starts the account-linking flow for the SIGNED-IN user, for any provider.
 *
 * Unlike the sign-in button, this runs under an authenticated session, which is
 * exactly what makes it safe: being logged in proves the user owns the local
 * account, so Better Auth links the provider without the email-verification
 * guard that blocks anonymous sign-in merges. `linkSocial` redirects the browser
 * to the provider and back to `callbackURL` (here, /account), so a successful
 * call never returns — we only see `result.error` when the redirect can't even
 * start (e.g. the provider isn't configured on the server).
 */
export function useLinkSocial() {
  return useMutation({
    mutationFn: async (provider: ProviderId) => {
      const result = await authClient.linkSocial({
        provider,
        callbackURL: `${window.location.origin}/account`,
        errorCallbackURL: `${window.location.origin}/account`,
      });
      if (result.error) {
        throw new Error(result.error.message ?? 'Could not start linking');
      }
      return result.data;
    },
  });
}

/**
 * Disconnects a linked provider. Better Auth refuses to remove a user's last
 * remaining sign-in method, so that failure surfaces as a toast rather than
 * locking the user out. Requires a fresh session (recent re-auth) server-side.
 */
export function useUnlinkAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { providerId: string; accountId: string }) => {
      const result = await authClient.unlinkAccount({
        providerId: input.providerId,
        accountId: input.accountId,
      });
      if (result.error) {
        throw new Error(result.error.message ?? 'Could not disconnect account');
      }
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: linkedAccountsKey });
    },
  });
}
