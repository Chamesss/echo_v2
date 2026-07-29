import { Navigate } from "react-router";
import { LoadingScreen } from "@/components/loading-screen";
import { getLastWorkspaceId } from "@/lib/local-storage";
import { paths } from "@/lib/paths";
import { useMyWorkspaces } from "@/features/workspaces/api/use-my-workspaces";

/**
 * Root route ("/"). Slack-like: you're always inside a workspace, with the
 * global rail (left) handling switching/creating. So this resolves straight to a
 * workspace — the one you were last in, else your first — or the create page if
 * you have none. (The 6.5 card-grid dashboard was replaced by the rail.)
 */
export default function Index() {
  const { data: workspaces, isPending } = useMyWorkspaces();

  if (isPending) return <LoadingScreen />;
  if (!workspaces || workspaces.length === 0) {
    return <Navigate to={paths.workspaceCreate} replace />;
  }

  const last = getLastWorkspaceId();
  const target = workspaces.find((w) => w.id === last) ?? workspaces[0]!;
  return <Navigate to={paths.workspace(target.id)} replace />;
}
