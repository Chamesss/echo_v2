import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { NotificationSummary } from "@server/modules/notifications/notifications.service";
import type { NotificationWire } from "@server/infrastructure/realtime/protocol";
import { UserRealtime } from "@/lib/user-realtime";
import { useSession } from "@/lib/auth-client";
import { isTabVisible } from "@/lib/visibility";
import { paths } from "@/lib/paths";
import { clearLastWorkspaceId } from "@/lib/local-storage";
import { channelsKey } from "@/features/channels/api/keys";
import { dmsKey } from "@/features/channels/api/use-dms";
import { myWorkspacesKey } from "@/features/workspaces/api/use-my-workspaces";
import type { ChannelDTO } from "@/features/channels/api/use-channels";
import type { DirectMessageDTO } from "@/features/channels/api/use-dms";
import { notificationsKey, notificationsSummaryKey } from "../api/keys";
import {
  addNotificationToSummary,
  bumpChannelUnread,
  bumpWorkspaceUnread,
  prependNotification,
} from "../store";

/**
 * Owns the single always-on awareness socket and folds its events into the
 * React Query caches so badges/inbox update live, everywhere, without a reload.
 *
 * Mounted under `RequireAuth` (above both the dashboard and the workspace shell)
 * so it survives navigation. The socket is the accelerator; on reconnect we
 * re-fetch the summary + inbox from the source of truth to heal anything missed.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();

  const [client] = useState(() => new UserRealtime());

  // The channel currently open in the URL — used to skip its unread bumps while
  // the tab is focused (the user is reading it; the workspace socket + markRead
  // already keep that conversation's cursor current). Held in a ref so a route
  // change doesn't tear down + reopen the socket — only its value is read inside
  // the event handler.
  const activeChannelRef = useRef<string | null>(null);
  activeChannelRef.current =
    location.pathname.match(/\/dashboard\/[^/]+\/channels\/([^/]+)/)?.[1] ?? null;

  // Idempotency guard: skip any event we've already applied. Defends against
  // at-least-once delivery / reconnect replays so a count never bumps twice.
  // Keyed `n:<notificationId>` and `u:<channelId>:<seq>` (each unique per event).
  const seen = useRef<Set<string>>(new Set());
  const firstSeen = (key: string): boolean => {
    if (seen.current.has(key)) return false;
    if (seen.current.size > 4000) seen.current.clear(); // bound memory
    seen.current.add(key);
    return true;
  };

  useEffect(() => {
    if (!userId) return;

    const offEvent = client.onEvent((event) => {
      if (event.kind === "unread.bump") {
        if (!firstSeen(`u:${event.channelId}:${event.updatedSeq}`)) return;
        // Skip the bump for the channel you're actively viewing (tab visible) —
        // ChannelView's cursor is marking it read. Visibility, not hasFocus (the
        // latter is false when DevTools/another window holds OS focus).
        if (event.channelId === activeChannelRef.current && isTabVisible()) return;

        // Sidebar badge for whichever list it lives in (harmless on the other).
        qc.setQueryData<ChannelDTO[]>(channelsKey(event.workspaceId), (l) =>
          bumpChannelUnread(l, event.channelId),
        );
        qc.setQueryData<DirectMessageDTO[]>(dmsKey(event.workspaceId), (l) =>
          bumpChannelUnread(l, event.channelId),
        );
        // Cross-workspace roll-up (dashboard / switcher badges).
        qc.setQueryData<NotificationSummary>(notificationsSummaryKey, (s) =>
          s ? bumpWorkspaceUnread(s, event.workspaceId, 1) : s,
        );
        return;
      }

      if (event.kind === "notification.created") {
        const n: NotificationWire = event.notification;
        if (!firstSeen(`n:${n.id}`)) return;
        // If you're actively viewing that channel (tab visible), it isn't "new" —
        // skip the inbox/unseen/toast; ChannelView marks it read.
        if (n.channelId === activeChannelRef.current && isTabVisible()) return;

        qc.setQueryData<NotificationWire[]>(notificationsKey, (l) => prependNotification(l, n));
        qc.setQueryData<NotificationSummary>(notificationsSummaryKey, (s) =>
          s ? addNotificationToSummary(s, n.workspaceId) : s,
        );

        // Global toast — fires anywhere in the app (the provider is app-wide).
        toast(n.actorName, {
          description: n.channelName ? `New message in #${n.channelName}` : "Sent you a message",
          action: {
            label: "View",
            onClick: () => navigate(paths.workspaceChannel(n.workspaceId, n.channelId)),
          },
        });
        return;
      }

      // ── Targeted structural events (dual-routed to this user) ─────────────
      if (event.kind === "channel.added") {
        // Added to a (private) channel → it appears in my list.
        qc.invalidateQueries({ queryKey: channelsKey(event.workspaceId) });
        return;
      }

      if (event.kind === "channel.removed") {
        // Removed from a channel → drop it; bounce me out if I'm viewing it.
        qc.invalidateQueries({ queryKey: channelsKey(event.workspaceId) });
        if (
          window.location.pathname ===
          paths.workspaceChannel(event.workspaceId, event.channelId)
        ) {
          toast.info("You were removed from this channel");
          navigate(paths.workspace(event.workspaceId), { replace: true });
        }
        return;
      }

      if (event.kind === "dm.created") {
        // A DM/group was opened with me → it appears in my sidebar.
        qc.invalidateQueries({ queryKey: dmsKey(event.workspaceId) });
        return;
      }

      if (event.kind === "workspace.deleted") {
        // A workspace I belonged to was deleted → drop it everywhere; if I'm
        // inside it, leave for the dashboard.
        qc.invalidateQueries({ queryKey: myWorkspacesKey });
        qc.invalidateQueries({ queryKey: notificationsSummaryKey });
        if (window.location.pathname.startsWith(`/dashboard/${event.workspaceId}`)) {
          clearLastWorkspaceId();
          toast.info("This workspace was deleted");
          navigate(paths.home, { replace: true });
        }
        return;
      }
    });

    const offStatus = client.onStatus((status, reconnected) => {
      // On (re)connect, re-seed from the source of truth to heal missed events.
      if (status === "open" && reconnected) {
        qc.invalidateQueries({ queryKey: notificationsSummaryKey });
        qc.invalidateQueries({ queryKey: notificationsKey });
      }
    });

    client.connect();
    return () => {
      offEvent();
      offStatus();
      client.close();
    };
  }, [client, qc, userId, navigate]);

  return <>{children}</>;
}
