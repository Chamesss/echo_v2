import { AuthLayout } from "@/components/layout/auth-layout";
import { CreateWorkspaceForm } from "@/features/workspaces/components/CreateWorkspaceForm";

/**
 * Create-workspace page (lazy-loaded by `router.tsx` at /workspaces/create).
 *
 * Auth comes from the `RequireAuth` layout above. Reuses the centered-card
 * `AuthLayout` (no sidebar shell) since the visual context is the same "you're
 * in a focused single-task flow." Reached two ways:
 *   1. Auto-redirect from / when the user has no workspaces (first-run UX)
 *   2. Manual navigation when an existing user wants to create another
 */
export default function CreateWorkspacePage() {
  return (
    <AuthLayout
      title="Create your workspace"
      description="A workspace is where you and your team chat in private."
    >
      <CreateWorkspaceForm />
    </AuthLayout>
  );
}
