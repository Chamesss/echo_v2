import { RedirectIfAuthed } from '@/features/auth/guards/RedirectIfAuthed';
import { AuthLayout } from '@/components/layout/auth-layout';
import { ForgotPasswordForm } from '@/features/auth/components/ForgotPasswordForm';

/**
 * Forgot-password page (lazy-loaded by `router.tsx` at /forgot-password).
 *
 * Guarded against logged-in users since they don't need to reset blind — if
 * they're signed in, /dashboard is more useful.
 */
export default function ForgotPasswordPage() {
  return (
    <RedirectIfAuthed>
      <AuthLayout
        title="Reset your password"
        description="Enter your email and we'll send you a link"
      >
        <ForgotPasswordForm />
      </AuthLayout>
    </RedirectIfAuthed>
  );
}
