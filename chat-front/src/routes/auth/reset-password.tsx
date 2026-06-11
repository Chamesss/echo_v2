import { AuthLayout } from '@/components/layout/auth-layout';
import { ResetPasswordForm } from '@/features/auth/components/ResetPasswordForm';

/**
 * Reset-password page (lazy-loaded by `router.tsx` at /reset-password).
 *
 * Intentionally NOT wrapped in `RedirectIfAuthed` — a user might be signed in
 * on another device when they request a reset, and we don't want to block the
 * recovery path. The token check inside `ResetPasswordForm` is the real gate.
 */
export default function ResetPasswordPage() {
  return (
    <AuthLayout
      title="Choose a new password"
      description="Make it strong and memorable"
    >
      <ResetPasswordForm />
    </AuthLayout>
  );
}
