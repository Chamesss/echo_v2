import { Outlet } from "react-router";
import { WorkspaceRail } from "./workspace-rail";

/**
 * The signed-in app frame: the global workspace rail on the far left + the
 * routed content (landing, create page, or the workspace shell) filling the
 * rest. Mounted once under `RequireAuth`, so the rail is always present and the
 * single global notification bell (in the rail) is reachable everywhere.
 */
export function AppFrame() {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <WorkspaceRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
