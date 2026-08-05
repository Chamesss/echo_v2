import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { AuthLayout } from "@/components/layout/auth-layout";
import { paths } from "@/lib/paths";
import { CreateWorkspaceForm } from "@/features/workspaces/components/CreateWorkspaceForm";
import { useMyWorkspaces } from "@/features/workspaces/api/use-my-workspaces";

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
  const { data: workspaces = [] } = useMyWorkspaces();

  return (
    <AuthLayout
      title="Create your workspace"
      description="A workspace is where you and your team chat in private."
    >
      <CreateWorkspaceForm />

      {/* The only way out of this page.
          It has no shell of its own, and the workspace rail — which used to
          provide the escape — is desktop-only now. On first run there is
          genuinely nowhere to go back TO, so this appears only once the user has
          a workspace to return to. */}
      {workspaces.length > 0 && (
        <Link
          to={paths.home}
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back
        </Link>
      )}
    </AuthLayout>
  );
}
