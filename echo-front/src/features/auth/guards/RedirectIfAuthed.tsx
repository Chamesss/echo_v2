import { type ReactNode } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { useSession } from '@/lib/auth-client';
import { paths } from '@/lib/paths';
import { LoadingScreen } from '@/components/loading-screen';
import { useEverResolved } from "@/lib/use-ever-resolved";

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
  const everResolved = useEverResolved(isPending);
  const [params] = useSearchParams();
  const inviteToken = params.get('invite');

  // First resolution only: `signIn.email` triggers a refetch, and unmounting
  // `children` mid-sign-in would wipe SignInForm's `twoFactorRequired` state.
  if (isPending && !everResolved) return <LoadingScreen />;
  // An already-signed-in visitor who followed an invite link goes to the accept
  // page (it auto-joins / shows a mismatch), not the generic home redirect.
  if (session?.user) {
    return <Navigate to={inviteToken ? paths.acceptInvite(inviteToken) : '/'} replace />;
  }

  return <>{children}</>;
}
