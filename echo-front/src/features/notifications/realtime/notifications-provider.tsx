import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { toast } from "sonner";
import type { NotificationSummary } from "@server/modules/notifications/notifications.service";
import type { NotificationWire } from "@server/infrastructure/realtime/protocol";
import { describeCoalesced } from "@server/modules/notifications/notification-copy";
import { UserRealtime } from "@/lib/user-realtime";
import type { RealtimeStatus } from "@/lib/reconnecting-socket";
import { useSession } from "@/lib/auth-client";
import { isTabVisible } from "@/lib/visibility";
import { paths } from "@/lib/paths";
import { clearLastWorkspaceId } from "@/lib/local-storage";
import { channelsKey } from "@/features/channels/api/keys";
import { dmsKey } from "@/features/channels/api/use-dms";
import { invalidateConversationLists } from "@/features/channels/api/conversation-lists";
import { myWorkspacesKey } from "@/features/workspaces/api/use-my-workspaces";
import type { ChannelDTO } from "@/features/channels/api/use-channels";
import type { DirectMessageDTO } from "@/features/channels/api/use-dms";
import { notificationsKey, notificationsSummaryKey } from "../api/keys";
import { SeenKeys } from "./seen-keys";
import {
  addNotificationToSummary,
  bumpChannelUnread,
  bumpWorkspaceUnread,
  hasConversation,
  prependNotification,
} from "../store";

interface UserRealtimeContextValue {
  status: RealtimeStatus;
  /** Manual retry, for when the socket closed on a terminal policy code. */
  restart: () => void;
}

/** How long a conversation's toast keeps absorbing follow-ups before starting over. */
export const TOAST_COALESCE_MS = 6_000;

/** The running state of one conversation's on-screen toast. */
interface ToastGroup {
  /** Sonner id — re-using it REPLACES the toast rather than stacking a new one. */
  id: string;
  /** Messages folded into it so far. */
  count: number;
  /** Senders, in arrival order, deduped — the "Alice and 2 others" part. */
  actors: string[];
  /** When it was last written, so a quiet gap starts a fresh toast. */
  updatedAt: number;
}

/**
 * Distinguishes one burst from the next, per conversation.
 *
 * A counter rather than a timestamp: `Date.now()` has millisecond resolution, so
 * several messages arriving in the same tick would mint the SAME id and appear
 * coalesced whether or not the grouping logic ran at all.
 */
let toastGeneration = 0;

/**
 * Show a toast for a message, folding it into the conversation's existing one —
 * a toast per message meant a busy group threw twenty pop-ups. Sonner treats a
 * repeated `id` as an update, so one toast rewrites itself in place.
 *
 * The group expires after `TOAST_COALESCE_MS` of quiet, so a much later message
 * reads as new instead of continuing a stale count.
 */
function showConversationToast(
  groups: Map<string, ToastGroup>,
  n: NotificationWire,
  onView: () => void,
): void {
  const now = Date.now();
  // Expired groups are dead weight — the map is keyed by conversation and the
  // provider lives for the whole session, so without this every conversation the
  // user ever received a message in stays in memory.
  for (const [channelId, group] of groups) {
    if (now - group.updatedAt >= TOAST_COALESCE_MS) groups.delete(channelId);
  }

  const prev = groups.get(n.channelId);
  const live = prev && now - prev.updatedAt < TOAST_COALESCE_MS ? prev : undefined;

  const group: ToastGroup = live
    ? {
        ...live,
        count: live.count + 1,
        actors: live.actors.includes(n.actorName) ? live.actors : [...live.actors, n.actorName],
        updatedAt: now,
      }
    : {
        id: `conv:${n.channelId}:${++toastGeneration}`,
        count: 1,
        actors: [n.actorName],
        updatedAt: now,
      };
  groups.set(n.channelId, group);

  const copy = describeCoalesced(n, group.actors, group.count);
  toast(copy.title, {
    id: group.id,
    description: copy.toastBody,
    action: { label: "View", onClick: onView },
  });
}

const UserRealtimeContext = createContext<UserRealtimeContextValue | null>(null);

/**
 * Awareness-socket connection state, for connection indicators.
 *
 * Safe to call outside the provider (the dashboard shell renders above it in
 * some routes) — it reports "open" rather than throwing, so an indicator never
 * becomes the reason a page fails to render.
 */
export function useUserRealtimeStatus(): UserRealtimeContextValue {
  return useContext(UserRealtimeContext) ?? { status: "open", restart: () => {} };
}

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
  const [status, setStatus] = useState<RealtimeStatus>("connecting");

  // The channel currently open in the URL — used to skip its unread bumps while
  // the tab is focused (the user is reading it; the workspace socket + markRead
  // already keep that conversation's cursor current). Held in a ref so a route
  // change doesn't tear down + reopen the socket — only its value is read inside
  // the event handler.
  const activeChannelRef = useRef<string | null>(null);
  const activeChannelId =
    location.pathname.match(/\/dashboard\/[^/]+\/channels\/([^/]+)/)?.[1] ?? null;
  useEffect(() => {
    activeChannelRef.current = activeChannelId;
  }, [activeChannelId]);

  // Idempotency guard: skip any event we've already applied. Defends against
  // at-least-once delivery / reconnect replays so a count never bumps twice.
  // Keyed `n:<notificationId>` and `u:<channelId>:<seq>` (each unique per event).
  const seen = useRef<SeenKeys>(new SeenKeys());
  const firstSeen = (key: string): boolean => seen.current.add(key);

  // One live toast per conversation — see `showConversationToast`.
  const toasts = useRef<Map<string, ToastGroup>>(new Map());

  useEffect(() => {
    if (!userId) return;

    /**
     * An event named a conversation the cached lists don't contain, so they're
     * stale — refetch.
     *
     * `dm.created` / `channel.added` are single-shot and best-effort, and
     * `bumpChannelUnread` is a SILENT no-op for an unknown id. So one missed
     * event left the conversation invisible until a reload, with the toast's
     * "View" dead-ending on "Channel not found".
     *
     * Only when a list is already cached — otherwise the mount fetch gets it.
     */
    const healUnknownConversation = (workspaceId: string, channelId: string): void => {
      const channels = qc.getQueryData<ChannelDTO[]>(channelsKey(workspaceId));
      const dms = qc.getQueryData<DirectMessageDTO[]>(dmsKey(workspaceId));
      if (channels === undefined && dms === undefined) return;
      if (hasConversation(channels, channelId) || hasConversation(dms, channelId)) return;
      invalidateConversationLists(qc, workspaceId);
    };

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
        // …unless it lives in NEITHER, in which case the bump just hit nothing.
        healUnknownConversation(event.workspaceId, event.channelId);
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

        qc.setQueryData<InfiniteData<NotificationWire[]>>(notificationsKey, (d) =>
          prependNotification(d, n),
        );
        qc.setQueryData<NotificationSummary>(notificationsSummaryKey, (s) =>
          s ? addNotificationToSummary(s, n.workspaceId) : s,
        );
        // The toast's "View" resolves the conversation from these lists, so heal
        // them too — otherwise clicking it lands on "Channel not found".
        healUnknownConversation(n.workspaceId, n.channelId);

        // Global toast — fires anywhere in the app (the provider is app-wide).
        showConversationToast(toasts.current, n, () =>
          navigate(paths.workspaceChannel(n.workspaceId, n.channelId)),
        );
        return;
      }

      // ── Targeted structural events (dual-routed to this user) ─────────────
      //
      // These carry only a channelId, so there's no way to tell from the event
      // whether the conversation belongs to the channel list or the DM list —
      // and group conversations live in the DM list. Hence
      // `invalidateConversationLists`, which refreshes both.
      if (event.kind === "channel.added") {
        // Added to a private channel or a group → it appears in my list.
        invalidateConversationLists(qc, event.workspaceId);
        return;
      }

      if (event.kind === "channel.removed") {
        // Removed → drop it; bounce me out if I'm viewing it.
        invalidateConversationLists(qc, event.workspaceId);
        // The server has just deleted my notifications for this conversation, and
        // its unread no longer counts toward the workspace. Neither cache would
        // notice on its own: the summary is `staleTime: Infinity` and refreshes
        // only on reconnect, so the workspace switcher kept showing a count for a
        // conversation I can't open — and an open tray kept listing entries whose
        // "View" now dead-ends.
        void qc.invalidateQueries({ queryKey: notificationsKey });
        void qc.invalidateQueries({ queryKey: notificationsSummaryKey });
        if (
          window.location.pathname ===
          paths.workspaceChannel(event.workspaceId, event.channelId)
        ) {
          toast.info("You no longer have access to this conversation");
          void navigate(paths.workspace(event.workspaceId), { replace: true });
        }
        return;
      }

      if (event.kind === "dm.created") {
        // A DM/group was opened with me → it appears in my sidebar.
        void qc.invalidateQueries({ queryKey: dmsKey(event.workspaceId) });
        return;
      }

      if (event.kind === "workspace.deleted") {
        // A workspace I belonged to was deleted → drop it everywhere; if I'm
        // inside it, leave for the dashboard.
        void qc.invalidateQueries({ queryKey: myWorkspacesKey });
        void qc.invalidateQueries({ queryKey: notificationsSummaryKey });
        if (window.location.pathname.startsWith(`/dashboard/${event.workspaceId}`)) {
          clearLastWorkspaceId();
          toast.info("This workspace was deleted");
          void navigate(paths.home, { replace: true });
        }
        return;
      }
    });

    const offStatus = client.onStatus((status, reconnected) => {
      setStatus(status);
      // On (re)connect, re-seed from the source of truth to heal missed events.
      if (status === "open" && reconnected) {
        void qc.invalidateQueries({ queryKey: notificationsSummaryKey });
        void qc.invalidateQueries({ queryKey: notificationsKey });
        // The conversation lists too: structural events (`dm.created`,
        // `channel.added`/`removed`) are single-shot, so anything that happened
        // while we were down is lost unless we reconcile here. Only ACTIVE
        // queries refetch, so in practice this is one request for the workspace
        // the user is actually looking at.
        void qc.invalidateQueries({
          predicate: (q) =>
            q.queryKey[0] === "ws" &&
            (q.queryKey[2] === "dms" || q.queryKey[2] === "channels"),
        });
      }
    });

    client.connect();
    return () => {
      offEvent();
      offStatus();
      client.close();
    };
  }, [client, qc, userId, navigate]);

  return (
    <UserRealtimeContext.Provider value={{ status, restart: () => client.restart() }}>
      {children}
    </UserRealtimeContext.Provider>
  );
}
