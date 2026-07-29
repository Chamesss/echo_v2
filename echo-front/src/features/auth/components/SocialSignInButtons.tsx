import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { signIn } from '@/lib/auth-client';
import { paths } from '@/lib/paths';
import { SOCIAL_PROVIDERS, type ProviderId } from '../social-providers';

/**
 * Renders a "Continue with <provider>" button for every entry in
 * `SOCIAL_PROVIDERS`. Shown on /login and /register — add a provider to the
 * registry and it appears in both automatically.
 *
 * `signIn.social` redirects the browser to the provider and back:
 *   - callbackURL       → land signed-in on `/`.
 *   - errorCallbackURL  → bounce post-OAuth failures (e.g. `account_not_linked`)
 *                         to /login, where `OAuthErrorNotice` explains how to
 *                         recover (sign in, then connect from Settings).
 * The `result.error` branch only catches failures *before* we leave the page
 * (e.g. the provider isn't configured on the server → 400); we surface those as
 * a toast and keep the rest of the auth UI usable.
 */
export function SocialSignInButtons() {
  const [params] = useSearchParams();
  const inviteToken = params.get('invite');

  const handleClick = async (provider: ProviderId) => {
    // On an invite, return from OAuth to the accept page (it auto-joins).
    const callbackURL = `${window.location.origin}${
      inviteToken ? paths.acceptInvite(inviteToken) : '/'
    }`;
    const result = await signIn.social({
      provider,
      callbackURL,
      errorCallbackURL: `${window.location.origin}/login`,
    });
    if (result?.error) {
      toast.error(result.error.message ?? 'Could not start sign-in');
    }
  };

  return (
    <div className="space-y-2">
      {SOCIAL_PROVIDERS.map((provider) => (
        <Button
          key={provider.id}
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => handleClick(provider.id)}
        >
          {provider.icon}
          Continue with {provider.label}
        </Button>
      ))}
    </div>
  );
}
