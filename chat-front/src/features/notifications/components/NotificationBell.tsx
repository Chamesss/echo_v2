import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Bell } from "lucide-react";
import type { NotificationWire } from "@server/infrastructure/realtime/protocol";
import { paths } from "@/lib/paths";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import {
  useMarkRead,
  useMarkSeen,
  useNotificationsList,
  useNotificationsSummary,
} from "../api/use-notifications";

/**
 * The Activity bell + dropdown. The badge counts UNSEEN notifications; opening
 * the tray marks them seen (clears the dot). Clicking an item navigates to its
 * conversation and marks that one read. Lives in the dashboard top bar and the
 * workspace shell header so it's reachable everywhere.
 */
export function NotificationBell() {
  const { data: summary } = useNotificationsSummary();
  const unseen = summary?.unseen ?? 0;

  const [open, setOpen] = useState(false);
  const { data: notifications = [], isPending } = useNotificationsList(open);
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
        // The bell lives in the workspace rail, so it wears the SIDEBAR theme;
        // the panel it opens (below) wears the mode tokens like other overlays.
        className="relative rounded-md p-2 text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="size-5" />
        {unseen > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-sidebar-badge px-1 text-[10px] font-semibold leading-4 text-sidebar-badge-foreground">
            {unseen > 99 ? "99+" : unseen}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          // Opens to the RIGHT of the narrow left rail, bottom-aligned to the
          // bell, so the panel never spills past the viewport edges.
          className="absolute bottom-0 left-full z-50 ml-2 flex max-h-[80vh] w-80 max-w-[calc(100vw-5rem)] flex-col overflow-hidden rounded-md border border-border bg-card shadow-lg"
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
                  <Avatar name={n.actorName} image={n.actorImage} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-foreground">{n.actorName}</span>{" "}
                    <span className="text-muted-foreground">
                      {n.channelName ? `posted in #${n.channelName}` : "sent you a message"}
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
          </div>
        </div>
      )}
    </div>
  );
}

function Avatar({ name, image }: { name: string; image: string | null }) {
  return <UserAvatar name={name} image={image} maxInitials={1} className="size-7 text-xs" />;
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
