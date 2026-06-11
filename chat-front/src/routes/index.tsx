import { Navigate } from "react-router";
import { LoadingScreen } from "@/components/loading-screen";
import { useMyWorkspaces } from "@/features/workspaces/api/use-my-workspaces";
import { resolveLandingPath } from "@/features/workspaces/utils/resolve-landing-path";
import { paths } from "@/lib/paths";

/**
 * Root route ("/") — pure redirector. Auth is handled by the `RequireAuth`
 * layout above, so this only runs for signed-in users.
 *
 * Fetch the user's workspaces and send them to the right place: create page if
 * they have none, otherwise the last-used (or first) workspace. See
 * `resolveLandingPath` for the picking logic.
 *
 * Failures fall through to /workspaces/create rather than blocking — better to
 * give the user a path forward than a blank error.
 */
export default function Index() {
  const { data: workspaces, isPending, error } = useMyWorkspaces();

  if (isPending) return <LoadingScreen />;
  if (error) return <Navigate to={paths.workspaceCreate} replace />;

  return <Navigate to={resolveLandingPath(workspaces ?? [])} replace />;
}
