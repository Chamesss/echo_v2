import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Bell } from "lucide-react";
import type { NotificationWire } from "@server/infrastructure/realtime/protocol";
import { describeNotification } from "@server/modules/notifications/notification-copy";
import { paths } from "@/lib/paths";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import { usePresence } from "@/features/members/api/use-presence";
import {
  useMarkRead,
  useMarkSeen,
  useNotificationsList,
  useNotificationsSummary,
} from "../api/use-notifications";

/**
 * Where the bell is mounted, which decides how its tray opens.
 *
 * The rail is a narrow column pinned to the left edge, so its tray opens
 * sideways and bottom-aligned. In the mobile top bar the same geometry would
 * throw the panel straight off the right of the screen, so it drops downward and
 * right-aligned instead. The two also sit on different surfaces: the rail wears
 * the sidebar palette, the top bar wears the page one.
 */
type BellPlacement = "rail" | "bar";

const TRAY_POSITION: Record<BellPlacement, string> = {
  rail: "bottom-0 left-full ml-2",
  bar: "right-0 top-full mt-2",
};

const BUTTON_STYLE: Record<BellPlacement, string> = {
  rail: "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
  bar: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
};

/**
 * The Activity bell + dropdown. The badge counts UNSEEN notifications; opening
 * the tray marks them seen (clears the dot). Clicking an item navigates to its
 * conversation and marks that one read. Mounted in the workspace rail on desktop
 * and in the mobile top bar, where the rail is hidden.
 */
export function NotificationBell({ placement = "rail" }: { placement?: BellPlacement } = {}) {
  const { data: summary } = useNotificationsSummary();
  const unseen = summary?.unseen ?? 0;

  const [open, setOpen] = useState(false);
  const { data, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useNotificationsList(open);
  const notifications = data?.pages.flat() ?? [];
  const markSeen = useMarkSeen();
  const markRead = useMarkRead();
  const navigate = useNavigate();
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);

  // Close on navigation.
  useEffect(() => setOpen(false), [location.pathname]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // Opening the tray clears the "unseen" dot.
    if (next && unseen > 0) markSeen.mutate();
  };

  const openItem = (n: NotificationWire) => {
    markRead.mutate({ ids: [n.id] });
    navigate(paths.workspaceChannel(n.workspaceId, n.channelId));
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label="Notifications"
        aria-haspopup="menu"
        aria-expanded={open}
        // Surface-dependent (see `BUTTON_STYLE`); the panel it opens always
        // wears the mode tokens, like every other overlay.
        className={cn("relative rounded-md p-2", BUTTON_STYLE[placement])}
      >
        <Bell className="size-5" />
        {unseen > 0 && (
          <span
            className={cn(
              "absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-4",
              placement === "rail"
                ? "bg-sidebar-badge text-sidebar-badge-foreground"
                : "bg-destructive text-destructive-foreground",
            )}
          >
            {unseen > 99 ? "99+" : unseen}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            "absolute z-50 flex max-h-[80vh] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md border border-border bg-card shadow-lg",
            TRAY_POSITION[placement],
          )}
        >
          <div className="shrink-0 border-b border-border px-3 py-2 text-sm font-semibold text-foreground">
            Notifications
          </div>
          <div className="flex-1 overflow-y-auto">
            {isPending ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>
            ) : notifications.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                You're all caught up.
              </p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  role="menuitem"
                  onClick={() => openItem(n)}
                  className={cn(
                    "flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent",
                    !n.readAt && "bg-accent/40",
                  )}
                >
                  <Avatar
                    name={n.actorName}
                    image={n.actorImage}
                    workspaceId={n.workspaceId}
                    userId={n.actorId}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-foreground">
                      {describeNotification(n).title}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      {describeNotification(n).body}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {relativeTime(n.createdAt)}
                    </span>
                  </span>
                  {!n.readAt && (
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-destructive" />
                  )}
                </button>
              ))
            )}

            {/* Only rendered when the server actually has more, so an exhausted
                list ends cleanly instead of showing a control that does nothing. */}
            {hasNextPage && (
              <button
                type="button"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
                className="w-full border-t border-border px-3 py-2 text-center text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-60"
              >
                {isFetchingNextPage ? "Loading…" : "Show older"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Presence is per-workspace but the bell is app-wide (it renders on the
 * dashboard too, outside any workspace context) and each item can come from a
 * different workspace — so the query lives HERE, per row, keyed by the
 * notification's own `workspaceId`. React Query dedupes by key, so rows from the
 * same workspace share one request, and the tray only mounts when it's open.
 */
function Avatar({
  name,
  image,
  workspaceId,
  userId,
}: {
  name: string;
  image: string | null;
  workspaceId: string;
  userId: string;
}) {
  const { data: online } = usePresence(workspaceId);
  return (
    <UserAvatar
      name={name}
      image={image}
      maxInitials={1}
      className="size-7 text-xs"
      online={online ? online.has(userId) : undefined}
    />
  );
}

/** Compact relative time ("just now", "5m", "3h", "2d") with a date fallback. */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}
