/**
 * Realtime wire contract — the single source of truth for what travels over the
 * `/ws` socket and the LISTEN/NOTIFY backplane, shared by the hub, the modules
 * that publish, and (mirrored) the frontend client.
 *
 * Design: the socket is a best-effort accelerator. Every message event carries
 * `updatedSeq` — the channel's monotonic change clock at the time of the event —
 * so clients detect gaps (`expected lastClock + 1`) and self-heal via the REST
 * catch-up endpoint. The DB sequence is the source of truth; the socket never is.
 */

/**
 * Close codes for sockets the server rejects after the handshake. The handshake
 * itself can't carry an HTTP status: authorization is async and the upgrade must
 * complete synchronously, so a rejection is a close frame on an accepted socket.
 * These are permanent for the session — clients must not retry on them.
 */
export const WS_CLOSE = {
  /** Malformed request (e.g. no `workspaceId`) or an abusive pre-auth client. */
  badRequest: 4400,
  /** No valid session on the upgrade request. */
  unauthorized: 4401,
  /** Untrusted origin, or not a member of the requested workspace. */
  forbidden: 4403,
} as const;

/** True when a close was a server policy rejection rather than a transient drop. */
export function isPolicyClose(code: number): boolean {
  return code >= 4400 && code < 4500;
}

/** A file attached to a message, as it appears on the wire. */
export interface AttachmentWire {
  id: string;
  filename: string;
  contentType: string;
  /** Size in bytes (S3-authoritative). */
  size: number;
  /** Policy bucket that drives client rendering. */
  category: "image" | "video" | "audio" | "document" | "file";
  /** Public URL to fetch/render the object. */
  url: string;
}

/** A message as it appears on the wire (REST responses + socket events). */
export interface MessageWire {
  id: string;
  channelId: string;
  authorId: string;
  body: string;
  clientId: string;
  /**
   * Files attached to the message. Present on read paths + the send response;
   * omitted (treated as none) on edit/delete events and withheld for departed
   * authors alongside the body.
   */
  attachments?: AttachmentWire[];
  /** Creation ordinal — immutable, used for stable ordering + history paging. */
  seq: number;
  /** Channel clock at the last mutation — the reconciliation key. */
  updatedSeq: number;
  version: number;
  deleted: boolean;
  /**
   * Whether the author is still a member of the workspace. Computed at read time
   * (history/catch-up). When false, the server blanks `body` and clients render
   * the row as an unavailable message from a "Former member" — reversibly: if
   * the author rejoins, the body and identity come back. Omitted (treated as
   * true) on live events, whose author just acted and is therefore a member.
   */
  authorActive?: boolean;
  /**
   * Denormalized author identity snapshot, set only on read paths
   * (history/catch-up). It lets the first paint show a name/avatar without
   * waiting on the workspace directory to load — killing the "raw id flash" on
   * a cold refresh. The directory remains the source of truth and OVERRIDES
   * these once loaded, so renames/avatar changes stay live. Omitted on live
   * write-path events (`message.created`/edits), whose author is resolved via
   * the already-loaded directory, and withheld for departed authors alongside
   * the body.
   */
  authorName?: string;
  authorImage?: string | null;
  createdAt: string;
  updatedAt: string | null;
}

/**
 * A channel event. Message create/edit/delete carry `updatedSeq` and drive the
 * client's gap detection; `read` and `typing` are broadcasts that do NOT consume
 * the clock (so they never trigger a false gap) — they carry no `updatedSeq` at
 * all, and the client's stream must return on them BEFORE it reads one.
 *
 * Every variant carries `channelId` — that's the discriminator the hub and the
 * client use to tell channel events apart from workspace events (which have no
 * channel). See `isChannelEvent`.
 */
export type ChannelEvent =
  | {
      kind: "message.created";
      channelId: string;
      updatedSeq: number;
      message: MessageWire;
    }
  | {
      kind: "message.updated";
      channelId: string;
      updatedSeq: number;
      message: MessageWire;
    }
  | {
      kind: "message.deleted";
      channelId: string;
      updatedSeq: number;
      message: MessageWire;
    }
  | {
      kind: "channel.read";
      channelId: string;
      userId: string;
      lastReadSeq: number;
    }
  | {
      kind: "typing";
      channelId: string;
      userId: string;
      state: "start" | "stop";
    };

/**
 * A workspace-scoped event — roster + channel-lifecycle changes that aren't tied
 * to one OPEN conversation and so fan out to EVERY socket in the workspace, not
 * just channel subscribers.
 *
 * Unlike message events these carry no `updatedSeq`: there's no per-channel clock
 * to reconcile, so clients react by re-syncing the affected REST queries (roster,
 * directory, channel list, message visibility) rather than by gap detection. The
 * DB stays the source of truth — these events only say "something changed, re-read
 * it." Channel-lifecycle events carry only the channel id for that reason: the
 * authoritative row comes from the (visibility-scoped) channels endpoint, so
 * broadcasting a private channel's id workspace-wide is harmless — a non-member's
 * refetch won't include it.
 *   - `member.added`        — joined via add-by-email or accepted invite; their
 *                             previously-withheld messages become readable again.
 *   - `member.removed`      — left or was removed; their messages get withheld.
 *   - `member.role_changed` — role updated (admin ↔ member).
 *   - `channel.created`     — a new channel exists (public appears for everyone).
 *   - `channel.updated`     — name/topic/archived/member-set changed; re-read it.
 *   - `channel.deleted`     — channel removed; drop it (and leave it if open).
 *   - `workspace.updated`   — the workspace was renamed; re-read its name.
 *   - `directory.updated`   — a member changed their name/avatar; re-read the
 *                             directory (so author names/avatars refresh live).
 */
export type WorkspaceEvent =
  | { kind: "member.added"; userId: string; role: "admin" | "member" }
  | { kind: "member.removed"; userId: string }
  | { kind: "member.role_changed"; userId: string; role: "admin" | "member" }
  | { kind: "channel.created"; channelId: string }
  | { kind: "channel.updated"; channelId: string }
  | { kind: "channel.deleted"; channelId: string }
  | { kind: "workspace.updated" }
  | { kind: "directory.updated" }
  | { kind: "presence.changed"; userId: string; online: boolean };

/** Anything that travels over the WORKSPACE socket + backplane: channel- or workspace-scoped. */
export type RealtimeEvent = ChannelEvent | WorkspaceEvent;

/**
 * The event kinds delivered only to a channel's open subscribers (vs. fanned out
 * to the whole workspace). Kept as an explicit set — NOT a structural `"channelId"
 * in event` check — because workspace-scoped channel-lifecycle events also carry a
 * `channelId` but must reach every socket, not just that channel's subscribers.
 */
const CHANNEL_EVENT_KINDS = new Set<RealtimeEvent["kind"]>([
  "message.created",
  "message.updated",
  "message.deleted",
  "channel.read",
  "typing",
]);

/** Narrow a realtime event to a channel (subscriber-scoped) event vs. a workspace-wide one. */
export function isChannelEvent(event: RealtimeEvent): event is ChannelEvent {
  return CHANNEL_EVENT_KINDS.has(event.kind);
}

// ─── Awareness layer (the always-on user socket) ──────────────────────────────
//
// The workspace socket above accelerates the OPEN conversation. The user socket
// is a separate, always-on connection that carries cross-everything awareness:
// unread bumps for any channel/DM in any workspace, and persisted notifications.
// It is scoped to a user (not a workspace) and reaches them wherever they are —
// including the dashboard, which holds no workspace socket. As with messages,
// these are best-effort accelerators: the authoritative counts come from REST
// (`last_seq − last_read_seq`) on load, so a missed event just trails until the
// next load/reconnect.

/** A persisted notification as it appears on the wire (inbox + socket events). */
export interface NotificationWire {
  id: string;
  /**
   * `'message'` for a channel message, `'dm'` for a direct message. `'mention'`
   * is reserved for a later pass (the tag/important system isn't built yet).
   */
  type: "message" | "dm" | "mention";
  workspaceId: string;
  channelId: string;
  /** Channel name snapshot for display ("in #general"); null for DMs. */
  channelName: string | null;
  messageId: string;
  /** The user who triggered it (sender). */
  actorId: string;
  /** Snapshot-free: resolved from control `users` at read time. */
  actorName: string;
  actorImage: string | null;
  /** Reserved for the future tag/important system — always false for now. */
  important: boolean;
  createdAt: string;
  /** Set when the user opened the notification tray (clears the global dot). */
  seenAt: string | null;
  /** Set when the user opened this specific item / its conversation. */
  readAt: string | null;
}

/**
 * User-scoped events delivered over the user socket.
 *   - `unread.bump`        — a message landed in a channel/DM the user belongs to;
 *                            the client increments that conversation's unread (and
 *                            the workspace roll-up) unless it's the active channel.
 *   - `notification.created` — a new persisted notification (DM today) for the inbox.
 *
 * The rest are DUAL-ROUTE targeted structural events — delivered here (rather than
 * over the workspace socket) so the affected user reacts even when they aren't
 * connected to that workspace's socket (e.g. on the dashboard or in another
 * workspace). Each carries `workspaceId` because this socket is cross-workspace.
 *   - `workspace.deleted`  — a workspace you belonged to was deleted; drop it and
 *                            leave if you're inside it.
 *   - `channel.added`      — you were added to a (private) channel; it appears.
 *   - `channel.removed`    — you were removed from a channel; it disappears (and
 *                            you're bounced out if you're viewing it).
 *   - `dm.created`         — a DM/group was opened with you; it appears in your list.
 */
export type UserEvent =
  | {
      kind: "unread.bump";
      workspaceId: string;
      channelId: string;
      channelType: "channel" | "dm";
      updatedSeq: number;
    }
  | { kind: "notification.created"; notification: NotificationWire }
  | { kind: "workspace.deleted"; workspaceId: string }
  | { kind: "channel.added"; workspaceId: string; channelId: string }
  | { kind: "channel.removed"; workspaceId: string; channelId: string }
  | { kind: "dm.created"; workspaceId: string; channelId: string };

/** Frames the server pushes over the WORKSPACE socket. */
export type ServerFrame =
  | { t: "event"; event: RealtimeEvent }
  | { t: "subscribed"; channelIds: string[] }
  | { t: "pong" }
  | { t: "error"; message: string };

/** Frames the server pushes over the USER (awareness) socket. */
export type UserServerFrame =
  | { t: "event"; event: UserEvent }
  | { t: "pong" }
  | { t: "error"; message: string };

/**
 * Frames a client sends to the WORKSPACE server. (Writes go over REST, never here.)
 *
 * `typing` is not an exception to that rule, because it isn't a write: nothing is
 * persisted, no sequence is consumed, no notification fires. It rides the socket
 * rather than a REST endpoint because the socket already knows who you are and
 * which channels you're authorized for (`SocketContext.channels`, populated by
 * the authorized `subscribe` below) — so a tick costs zero queries, where REST
 * would cost three (session lookup, workspace load, membership check) on every
 * throttle tick.
 */
export type ClientFrame =
  | { t: "subscribe"; channelIds: string[] }
  | { t: "unsubscribe"; channelIds: string[] }
  | { t: "typing"; channelId: string; state: "start" | "stop" }
  | { t: "ping" };

/** Frames a client sends over the USER socket (heartbeat only — no subscriptions). */
export type UserClientFrame = { t: "ping" };

/** Backplane channel name for a workspace's events (Postgres NOTIFY channel). */
export function workspaceNotifyChannel(workspaceId: string): string {
  return `rt_ws_${workspaceId}`;
}

/** Backplane channel name for a user's awareness events (Postgres NOTIFY channel). */
export function userNotifyChannel(userId: string): string {
  return `rt_user_${userId}`;
}
