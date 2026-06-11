import { useRef, type ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useSession } from '@/lib/auth-client';
import { LoadingScreen } from '@/components/loading-screen';

/**
 * Inverse of `RequireAuth` — used on /login, /register, /forgot-password to
 * bounce already-signed-in users to the app. Without it, a logged-in user
 * who clicks the "Sign in" link in the nav would land on the login page
 * with the form awkwardly visible.
 *
 * Not applied to /reset-password — a user might be signed in on a different
 * device when they request a reset, and we don't want to block the flow.
 */
export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();

  // better-auth's `useSession` flips `isPending` back to true on every
  // background refetch while there's still no session (its refetch sets
  // `isPending = data === null`). `signIn.email` triggers exactly such a
  // refetch, so a naive `if (isPending)` would swap in the loading screen
  // mid-sign-in and unmount `children` — wiping SignInForm's local
  // `twoFactorRequired` state and bouncing the user back to an empty form.
  // Only block on the FIRST resolution; after that, keep children mounted
  // through refetches.
  const everResolved = useRef(false);
  if (!isPending) everResolved.current = true;

  if (isPending && !everResolved.current) return <LoadingScreen />;
  if (session?.user) return <Navigate to="/" replace />;

  return <>{children}</>;
}
