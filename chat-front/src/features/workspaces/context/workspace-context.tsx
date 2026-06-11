import { createContext, useContext, type ReactNode } from "react";
import type { Workspace } from "../api/use-my-workspaces";

/**
 * Holds the resolved current workspace for everything rendered inside
 * `WorkspaceLayout`. The layout fetches + validates membership once, then makes
 * the workspace available here so inner pages (home, settings, admin, future
 * channels) and `AppShell` read it without re-deriving from the URL or
 * re-running the query — and without the `if (!workspace) return null` guard,
 * since the layout never mounts this provider until the workspace is present.
 */
const WorkspaceContext = createContext<Workspace | null>(null);

export function WorkspaceProvider({
  workspace,
  children,
}: {
  workspace: Workspace;
  children: ReactNode;
}) {
  return <WorkspaceContext.Provider value={workspace}>{children}</WorkspaceContext.Provider>;
}

/**
 * The current workspace, guaranteed non-null. Throws if called outside
 * `WorkspaceLayout` — a programmer error, not a runtime state to handle.
 */
export function useCurrentWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) {
    throw new Error("useCurrentWorkspace must be used within a WorkspaceLayout");
  }
  return workspace;
}
