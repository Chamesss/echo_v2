import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { paths } from "@/lib/paths";
import { useCurrentWorkspace } from "@/features/workspaces/context/workspace-context";
import {
  useMyWorkspaces,
  type Workspace,
} from "@/features/workspaces/api/use-my-workspaces";
import { useWorkspaceUnread } from "@/features/notifications/hooks/use-workspace-unread";

/**
 * Sidebar-header workspace switcher. Shows the current workspace + role and, on
 * click, a menu to jump to any of the user's workspaces (each with its live
 * unread badge), return to the dashboard ("All workspaces"), or create one.
 * Fills the flex header next to the notification bell (chrome is the parent's).
 */
export function WorkspaceSwitcher() {
  const current = useCurrentWorkspace();
  const location = useLocation();
  const { data: workspaces = [] } = useMyWorkspaces();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on navigation.
  useEffect(() => setOpen(false), [location.pathname]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative h-full min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-full w-full items-center gap-2 px-4 text-left hover:bg-sidebar-accent"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-sidebar-foreground">
            {current.name}
          </div>
          <div className="truncate text-xs capitalize text-sidebar-muted-foreground">
            {current.role}
          </div>
        </div>
        <ChevronsUpDown className="size-4 shrink-0 text-sidebar-muted-foreground" />
      </button>

      {open && (
        // Dropdown uses the MODE tokens, not the sidebar theme — it overlays
        // the page and should read as page chrome.
        <div
          role="menu"
          className="absolute left-2 right-2 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-card text-foreground shadow-lg"
        >
          <div className="max-h-64 overflow-y-auto py-1">
            {workspaces.map((w) => (
              <SwitcherRow
                key={w.id}
                workspace={w}
                isCurrent={w.id === current.id}
              />
            ))}
          </div>
          <div className="border-t border-border py-1">
            <Link
              to={paths.workspaceCreate}
              role="menuitem"
              className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <Plus className="size-4" /> Create workspace
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** One workspace row in the switcher menu, with its live unread badge. */
function SwitcherRow({
  workspace,
  isCurrent,
}: {
  workspace: Workspace;
  isCurrent: boolean;
}) {
  const navigate = useNavigate();
  const { unread } = useWorkspaceUnread(workspace.id);
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => navigate(paths.workspace(workspace.id))}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
    >
      <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
      {unread > 0 && (
        <span className="rounded-full bg-destructive px-1.5 text-[10px] font-semibold leading-4 text-destructive-foreground">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
      <span className="text-[10px] capitalize text-muted-foreground">
        {workspace.role}
      </span>
      {isCurrent && <Check className="size-4 shrink-0 text-foreground" />}
    </button>
  );
}
