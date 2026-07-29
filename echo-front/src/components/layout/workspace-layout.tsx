import { useEffect } from "react";
import { Navigate, useParams } from "react-router";
import { ApiError } from "@/lib/api";
import { paths } from "@/lib/paths";
import { LoadingScreen } from "@/components/loading-screen";
import { setLastWorkspaceId } from "@/lib/local-storage";
import { useWorkspace } from "@/features/workspaces/api/use-workspace";
import { WorkspaceProvider } from "@/features/workspaces/context/workspace-context";
import { RealtimeProvider } from "@/features/channels/realtime/realtime-context";
import { AppShell } from "./app-shell";

/**
 * Layout route for everything under `/dashboard/:workspaceId/*`.
 *
 * Resolves the workspace from the URL and enforces membership (absorbing the old
 * `RequireMembership` guard): the backend's `loadWorkspace` middleware returns
 * 403 for non-members / 404 for unknown ids, which we translate into a redirect
 * to `/` (the index route then re-resolves to a workspace the user belongs to,
 * or the create page). Once resolved, it provides the workspace via context and
 * renders the sidebar shell (`AppShell`), whose `<Outlet/>` hosts the inner page.
 *
 * Pairs with the outer `RequireAuth` layout, so it never runs anonymously.
 */
export function WorkspaceLayout() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { data: workspace, isPending, error } = useWorkspace(workspaceId ?? "");

  // Remember the active workspace so a refresh / next sign-in lands back here.
  // Lives at the layout (not the home page) so it stays in sync on any inner
  // page (settings, admin, …), not only the workspace home.
  useEffect(() => {
    if (workspace?.id) setLastWorkspaceId(workspace.id);
  }, [workspace?.id]);

  if (!workspaceId) return <Navigate to={paths.home} replace />;
  if (isPending) return <LoadingScreen />;

  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
    return <Navigate to={paths.home} replace />;
  }

  if (!workspace) return <LoadingScreen />;

  return (
    <WorkspaceProvider workspace={workspace}>
      {/* key by workspace so switching tears down the old socket + spins up a
          fresh one for the new workspace. */}
      <RealtimeProvider key={workspace.id} workspaceId={workspace.id}>
        <AppShell />
      </RealtimeProvider>
    </WorkspaceProvider>
  );
}
