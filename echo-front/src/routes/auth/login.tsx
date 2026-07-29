import { RedirectIfAuthed } from '@/features/auth/guards/RedirectIfAuthed';
import { AuthLayout } from '@/components/layout/auth-layout';
import { SignInForm } from '@/features/auth/components/SignInForm';
import { OAuthErrorNotice } from '@/features/auth/components/OAuthErrorNotice';

/**
 * Login page (lazy-loaded by `router.tsx` at /login).
 *
 * Thin composition: gate it from already-signed-in users, wrap in the auth
 * card layout, render the sign-in form. All business logic lives in the
 * feature module.
 */
export default function LoginPage() {
  return (
    <RedirectIfAuthed>
      <AuthLayout title="Welcome back" description="Sign in to continue">
        <div className="space-y-4">
          <OAuthErrorNotice />
          <SignInForm />
        </div>
      </AuthLayout>
    </RedirectIfAuthed>
  );
}
