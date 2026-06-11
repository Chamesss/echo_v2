import { RedirectIfAuthed } from '@/features/auth/guards/RedirectIfAuthed';
import { AuthLayout } from '@/components/layout/auth-layout';
import { SignUpForm } from '@/features/auth/components/SignUpForm';

/**
 * Registration page (lazy-loaded by `router.tsx` at /register).
 *
 * Same composition pattern as `/login` — guard, layout, form. The form
 * itself decides whether to navigate to `/workspaces/create` or `/dashboard`
 * after success (Phase 3 wires the workspace check; today it just goes to `/`).
 */
export default function RegisterPage() {
  return (
    <RedirectIfAuthed>
      <AuthLayout
        title="Create your account"
        description="Start with email or continue with Google"
      >
        <SignUpForm />
      </AuthLayout>
    </RedirectIfAuthed>
  );
}
