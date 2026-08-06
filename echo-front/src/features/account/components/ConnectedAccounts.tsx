import { toast } from 'sonner';
import { toastError } from '@/lib/toast-error';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SOCIAL_PROVIDERS, type ProviderId } from '@/features/auth/social-providers';
import {
  useLinkSocial,
  useLinkedAccounts,
  useUnlinkAccount,
} from '../api/use-linked-accounts';

/**
 * Connected accounts: shows which sign-in methods are active and lets the user
 * link or unlink each social provider in `SOCIAL_PROVIDERS` (so adding a
 * provider to that registry surfaces it here automatically).
 *
 * This is the recovery path for the `account_not_linked` collision — a user who
 * signed up with email/password and later wants a social login connects it here,
 * under an authenticated session (which is what makes the link safe; see
 * `useLinkSocial`). Unlinking is blocked for the user's last remaining method so
 * they can't lock themselves out.
 */
export function ConnectedAccounts() {
  const { data: accounts = [], isPending } = useLinkedAccounts();
  const linkSocial = useLinkSocial();
  const unlink = useUnlinkAccount();

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Loading connected accounts…</p>;
  }

  const hasPassword = accounts.some((a) => a.providerId === 'credential');
  // Total distinct sign-in methods (credential + each linked social). Used to
  // block removing the last one.
  const canUnlinkAny = accounts.length > 1;

  const handleConnect = (provider: ProviderId) => {
    // On success this redirects to the provider, so we only ever hit onError.
    linkSocial.mutate(provider, { onError: toastError });
  };

  const handleDisconnect = (providerId: ProviderId, accountId: string, label: string) => {
    unlink.mutate(
      { providerId, accountId },
      {
        onSuccess: () => toast.success(`${label} disconnected`),
        onError: toastError,
      },
    );
  };

  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {hasPassword && (
        <li className="flex items-center justify-between gap-3 p-3">
          <div className="flex min-w-0 items-center gap-3">
            <KeyRound className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 text-sm">
              <div className="font-medium text-foreground">Email &amp; password</div>
              <div className="text-xs text-muted-foreground">Enabled</div>
            </div>
          </div>
        </li>
      )}

      {SOCIAL_PROVIDERS.map((provider) => {
        const linked = accounts.find((a) => a.providerId === provider.id);
        // react-query shares one mutation here, so scope the pending state to
        // the provider actually being connected.
        const connecting = linkSocial.isPending && linkSocial.variables === provider.id;

        return (
          <li key={provider.id} className="flex items-center justify-between gap-3 p-3">
            <div className="flex min-w-0 items-center gap-3">
              {provider.icon}
              <div className="min-w-0 text-sm">
                <div className="font-medium text-foreground">{provider.label}</div>
                <div className="text-xs text-muted-foreground">
                  {linked ? 'Connected' : 'Not connected'}
                </div>
              </div>
            </div>

            {linked ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={unlink.isPending || !canUnlinkAny}
                title={
                  canUnlinkAny
                    ? undefined
                    : 'Add another sign-in method before disconnecting your only one'
                }
                onClick={() => handleDisconnect(provider.id, linked.accountId, provider.label)}
              >
                Disconnect
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={connecting}
                onClick={() => handleConnect(provider.id)}
              >
                {connecting ? 'Redirecting…' : 'Connect'}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
