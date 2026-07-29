import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { LogOut, Plus } from "lucide-react";
import { Image } from "@/components/ui/image";
import { cn } from "@/lib/utils";
import { paths } from "@/lib/paths";
import { clearLastWorkspaceId } from "@/lib/local-storage";
import { clearCachedPreferences } from "@/features/appearance/storage";
import { useSession } from "@/lib/auth-client";
import { useSignOut } from "@/features/auth/api/use-sign-out";
import {
  useMyWorkspaces,
  type Workspace,
} from "@/features/workspaces/api/use-my-workspaces";
import { useWorkspaceUnread } from "@/features/notifications/hooks/use-workspace-unread";
import { NotificationBell } from "@/features/notifications/components/NotificationBell";

/**
 * Slack-style global workspace rail — a narrow always-on column at the far left
 * of the signed-in app. Lists every workspace as a square avatar (switch on
 * click, live unread badge), a "+" to create one, and at the bottom the single
 * GLOBAL notification bell + a user menu (sign out). Lives above the workspace
 * shell so it's present on the landing, the create page, and inside a workspace.
 */
export function WorkspaceRail() {
  const { data: workspaces = [] } = useMyWorkspaces();
  const location = useLocation();
  const activeId = location.pathname.match(/\/dashboard\/([^/]+)/)?.[1] ?? null;

  return (
    <nav
      aria-label="Workspaces"
      className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-sidebar-border bg-sidebar py-3 text-sidebar-foreground"
    >
      <div className="flex flex-1 flex-col items-center gap-2 overflow-y-auto">
        {workspaces.map((w) => (
          <RailWorkspace key={w.id} workspace={w} active={w.id === activeId} />
        ))}
        <Link
          to={paths.workspaceCreate}
          aria-label="Create workspace"
          title="Create workspace"
          className="flex size-11 items-center justify-center rounded-2xl border border-dashed border-sidebar-border text-sidebar-muted-foreground transition hover:border-sidebar-foreground hover:text-sidebar-foreground"
        >
          <Plus className="size-5" />
        </Link>
      </div>

      <NotificationBell />
      <UserMenu />
    </nav>
  );
}

function RailWorkspace({
  workspace,
  active,
}: {
  workspace: Workspace;
  active: boolean;
}) {
  const navigate = useNavigate();
  const { unread } = useWorkspaceUnread(workspace.id);
  const initials = workspace.name.slice(0, 2).toUpperCase();

  return (
    <button
      type="button"
      title={workspace.name}
      aria-label={workspace.name}
      aria-current={active ? "true" : undefined}
      onClick={() => navigate(paths.workspace(workspace.id))}
      className="group relative flex size-11 items-center justify-center"
    >
      {/* Active indicator pip on the rail's left edge (Slack-like). */}
      <span
        className={cn(
          "absolute -left-3 w-1 rounded-r-full bg-sidebar-foreground transition-all",
          active ? "h-8" : "h-0 group-hover:h-4",
        )}
      />
      <span
        className={cn(
          "flex size-11 items-center justify-center text-sm font-semibold transition-all",
          active
            ? "rounded-2xl bg-sidebar-active text-sidebar-active-foreground"
            : "rounded-3xl bg-sidebar-accent text-sidebar-foreground group-hover:rounded-2xl group-hover:bg-sidebar-accent",
        )}
      >
        {initials}
      </span>
      {unread > 0 && (
        // `ring-sidebar` punches the badge out of the rail background, so it
        // reads as a separate chip on every theme.
        <span className="absolute right-0 top-0 flex w-3.5 h-3.5 items-center justify-center rounded-full bg-sidebar-badge px-1 text-[10px] font-semibold leading-4 text-sidebar-badge-foreground ring-2 ring-sidebar">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}

/** User avatar at the rail's foot with a small sign-out menu. */
function UserMenu() {
  const { data: session } = useSession();
  const { mutate: signOut, isPending } = useSignOut();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const handleSignOut = () =>
    signOut(undefined, {
      onSuccess: () => {
        clearLastWorkspaceId();
        // Drop the cached theme too, so the next person on this browser gets
        // the default rather than inheriting this user's appearance.
        clearCachedPreferences();
        toast.success("Signed out");
        navigate(paths.login);
      },
      onError: (err) => toast.error(err.message),
    });

  const initial = (session?.user.name ?? "?").charAt(0).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex size-9 items-center justify-center overflow-hidden rounded-full bg-sidebar-accent text-sm font-semibold text-sidebar-foreground ring-1 ring-sidebar-border hover:ring-sidebar-ring"
      >
        {/* Image, not UserAvatar: the button already supplies the round shape
            and the sidebar-specific ring/background the fallback letter sits on. */}
        <Image
          src={session?.user.image}
          alt=""
          priority
          className="size-full object-cover"
          fallback={initial}
        />
      </button>

      {open && (
        <div
          role="menu"
          // The menu floats over the main column, so it uses the MODE tokens,
          // not the sidebar theme — it reads as part of the page, not the rail.
          className="absolute bottom-0 left-full z-50 ml-2 w-56 overflow-hidden rounded-md border border-border bg-card text-foreground shadow-lg"
        >
          <div className="border-b border-border px-3 py-2 text-xs">
            <div className="truncate font-medium text-foreground">
              {session?.user.name}
            </div>
            <div className="truncate text-muted-foreground">
              {session?.user.email}
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            disabled={isPending}
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-accent disabled:opacity-50"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
