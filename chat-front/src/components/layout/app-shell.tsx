import { useEffect, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import {
  LogOut,
  Menu,
  Settings,
  Shield,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { useSignOut } from "@/features/auth/api/use-sign-out";
import { useCurrentWorkspace } from "@/features/workspaces/context/workspace-context";
import { ChannelList } from "@/features/channels/components/ChannelList";
import { DmList } from "@/features/channels/components/DmList";
import { clearLastWorkspaceId } from "@/lib/local-storage";
import { paths } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useWorkspaceEvents } from "@/features/workspaces/realtime/use-workspace-events";
import { PageTitleProvider, usePageTitle } from "./page-title-context";
import { WorkspaceSwitcher } from "./workspace-switcher";

/**
 * Workspace shell: sidebar nav + an `<Outlet/>` content area. Mounted by
 * `WorkspaceLayout`, so it reads the current workspace from context and every
 * nested `/dashboard/:workspaceId/*` route renders inside it.
 *
 * Responsive:
 *   - lg+    → the sidebar is a static column; no top bar (the page's own header
 *              serves as the top bar and lines up with the sidebar header).
 *   - < lg   → the sidebar collapses; a top bar with a hamburger opens it as an
 *              off-canvas drawer over a dimmed overlay. The drawer closes on
 *              route change, overlay tap, or its close button.
 *
 * The sidebar's contents are defined once (`sidebar`) and reused by both the
 * desktop column and the mobile drawer so they never drift apart.
 */
export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: session } = useSession();
  const { mutate: signOut, isPending } = useSignOut();
  const workspace = useCurrentWorkspace();

  // Live-sync roster changes (joins/leaves/role/removal) into the cache so the
  // UI reflects them without a reload.
  useWorkspaceEvents();

  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the drawer whenever the route changes (e.g. a nav link was tapped).
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const handleSignOut = () => {
    signOut(undefined, {
      onSuccess: () => {
        clearLastWorkspaceId();
        toast.success("Signed out");
        navigate(paths.login);
      },
      onError: (err) => toast.error(err.message),
    });
  };

  const sidebar = (
    <>
      <div className="flex h-16 shrink-0 items-center border-b border-border">
        <WorkspaceSwitcher />
      </div>

      <nav className="flex-1 space-y-3 overflow-y-auto p-2">
        <ChannelList />
        <DmList />
        <div className="space-y-1 border-t border-border pt-2">
          <SidebarLink
            icon={<Users />}
            label="Members"
            to={paths.workspaceMembers(workspace.id)}
          />
          {workspace.role === "admin" && (
            <SidebarLink
              icon={<SlidersHorizontal />}
              label="Workspace"
              to={paths.workspaceManage(workspace.id)}
            />
          )}
          <SidebarLink
            icon={<Settings />}
            label="Settings"
            to={paths.workspaceSettings(workspace.id)}
          />
          {session?.user.role === "admin" && (
            <SidebarLink
              icon={<Shield />}
              label="Admin"
              to={paths.workspaceAdmin(workspace.id)}
            />
          )}
        </div>
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <div className="mb-2 px-1 text-xs text-muted-foreground">
          <div className="truncate font-medium text-foreground">
            {session?.user.name}
          </div>
          <div className="truncate">{session?.user.email}</div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={isPending}
          onClick={handleSignOut}
        >
          <LogOut /> Sign out
        </Button>
      </div>
    </>
  );

  return (
    <PageTitleProvider>
      {/* min-h-0 flex-1 fills the RootLayout content column (the space below the
          optional impersonation banner); overflow-hidden keeps scrolling inside
          <main>, so the sidebar stays put and a tall page can't stretch it. */}
      <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
        {/* Desktop sidebar — static column. */}
        <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-muted/20 lg:flex">
          {sidebar}
        </aside>

        {/* Mobile overlay. */}
        <div
          className={cn(
            "fixed inset-0 z-40 bg-black/50 transition-opacity lg:hidden",
            mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />

        {/* Mobile off-canvas drawer. */}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-background shadow-xl transition-transform duration-200 lg:hidden",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
          aria-label="Sidebar"
        >
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="absolute right-2 top-3 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <X className="size-4" />
          </button>
          {sidebar}
        </aside>

        {/* Main column. */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Mobile top bar — only when the sidebar is collapsed. Shows the active
            page's title, falling back to the workspace name. */}
          <MobileTopBar
            fallback={workspace.name}
            onOpen={() => setMobileOpen(true)}
          />

          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </PageTitleProvider>
  );
}

function MobileTopBar({
  fallback,
  onOpen,
}: {
  fallback: string;
  onOpen: () => void;
}) {
  const title = usePageTitle();
  return (
    <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border bg-card px-3 lg:hidden">
      <Button variant="ghost" size="sm" onClick={onOpen} aria-label="Open menu">
        <Menu />
      </Button>
      <div className="truncate text-sm font-semibold text-foreground">
        {title ?? fallback}
      </div>
    </div>
  );
}

function SidebarLink({
  icon,
  label,
  to,
}: {
  icon: ReactNode;
  label: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    >
      <span className="[&_svg]:size-4">{icon}</span>
      <span>{label}</span>
    </Link>
  );
}
