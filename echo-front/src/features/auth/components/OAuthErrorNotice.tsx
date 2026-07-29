import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/**
 * Renders a friendly explanation when a social sign-in bounces back to /login
 * with an `?error=` code (see `SocialSignInButtons`' `errorCallbackURL`).
 *
 * The important case is `account_not_linked`: an email/password account already
 * owns this email but its email was never verified, so Better Auth refuses to
 * silently merge Google onto it (the pre-registration takeover guard). Rather
 * than showing the raw code, we tell the user exactly how to recover — sign in
 * with their password, then connect Google from Account settings.
 *
 * The code is read once into state and then stripped from the URL (replace, no
 * history entry) so a refresh or a later successful sign-in doesn't resurface
 * a stale banner, while the message stays visible for this render.
 */
const MESSAGES: Record<string, { title: string; description: string }> = {
  account_not_linked: {
    title: 'This email already has an account',
    description:
      'You previously signed up with an email and password. Sign in below with those, then connect Google from Account settings → Connected accounts.',
  },
};

const FALLBACK = {
  title: "Couldn't finish Google sign-in",
  description: 'Something went wrong completing Google sign-in. Please try again.',
};

export function OAuthErrorNotice() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Capture the code once, on mount, before the effect scrubs it from the URL.
  const [code] = useState(() => searchParams.get('error'));

  // Drop the param from the address bar (replace, no history entry) so the
  // banner doesn't reappear on refresh / back navigation. Runs after render to
  // avoid mutating router state mid-render.
  useEffect(() => {
    if (!searchParams.has('error') && !searchParams.has('error_description')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('error');
    next.delete('error_description');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  if (!code) return null;

  const { title, description } = MESSAGES[code] ?? FALLBACK;

  return (
    <Alert variant="destructive" className="max-w-xs">
      <AlertCircle className="size-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
}
