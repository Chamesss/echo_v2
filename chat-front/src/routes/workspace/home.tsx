import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";

/**
 * Workspace home — the index route of `/dashboard/:workspaceId`, rendered inside
 * `AppShell` via the workspace layout's `<Outlet/>`.
 *
 * Placeholder hero for now; channels + messaging take over this main area in
 * Phase 4+. Auth, membership, the sidebar shell, and last-workspace sync all
 * live in the layout chain above — this page is just content.
 */
export default function WorkspaceHome() {
  const workspace = useCurrentWorkspace();

  return (
    <div className="flex h-full items-center justify-center p-12">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-foreground">Welcome to {workspace.slug}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick a channel from the sidebar to start chatting, or create one with the +.
        </p>
      </div>
    </div>
  );
}
