/**
 * The single event point for workspace-scoped realtime.
 *
 * Every workspace mutation that live clients must react to is DEFINED here (the
 * `RealtimeEvents` builder catalog) and DISPATCHED here (`emitWorkspaceEvent` /
 * `emitUserEvents`). Modules import these instead of hand-building `{ kind: … }`
 * literals and calling `hub.publish` directly, so the wire payloads can't drift
 * and there's one place to add an event or change a transport.
 *
 * Transports (see `protocol.ts` for the wire contract):
 *   - WORKSPACE socket  → `emitWorkspaceEvent` — fans out to every socket in the
 *     workspace (roster + channel-lifecycle changes).
 *   - USER socket       → `emitUserEvents` — the always-on, cross-workspace socket;
 *     used to DUAL-ROUTE targeted events to a specific user even when they aren't
 *     connected to that workspace's socket (e.g. on the dashboard). See the
 *     reserved actions below.
 *
 * All dispatch is BEST-EFFORT: the DB is the source of truth and clients self-heal
 * from REST on their next load/reconnect, so a publish failure is logged, never
 * thrown into the request path.
 *
 * Audit (the forensic trail) is a separate concern recorded via
 * `audit/audit-log.ts#logWorkspaceEvent` from the controllers, which hold the
 * request context (ip/user-agent). Its `WorkspaceEventName` enumeration is
 * re-exported here so all event names are reachable from one module.
 */

import { hub } from "./hub.js";
import { logger } from "../../shared/logger/logger.js";
import type { UserEvent, WorkspaceEvent } from "./protocol.js";

export { WorkspaceEventName } from "../audit/audit-log.js";
export type { WorkspaceEvent, UserEvent } from "./protocol.js";

type Role = "admin" | "member";

/**
 * The typed builder catalog — the single definition of every workspace realtime
 * event. Construct events through these so call sites stay terse and payloads
 * are guaranteed to match the wire contract.
 */
export const RealtimeEvents = {
  memberAdded: (userId: string, role: Role): WorkspaceEvent => ({
    kind: "member.added",
    userId,
    role,
  }),
  memberRemoved: (userId: string): WorkspaceEvent => ({ kind: "member.removed", userId }),
  memberRoleChanged: (userId: string, role: Role): WorkspaceEvent => ({
    kind: "member.role_changed",
    userId,
    role,
  }),
  channelCreated: (channelId: string): WorkspaceEvent => ({ kind: "channel.created", channelId }),
  channelUpdated: (channelId: string): WorkspaceEvent => ({ kind: "channel.updated", channelId }),
  channelDeleted: (channelId: string): WorkspaceEvent => ({ kind: "channel.deleted", channelId }),
  /**
   * A user lost access to a channel. Workspace-scoped on purpose: the hub uses
   * it to revoke that user's live subscription on whichever instance holds
   * their workspace socket (see `hub.revokeChannel`).
   */
  channelMemberRemoved: (channelId: string, userId: string): WorkspaceEvent => ({
    kind: "channel.member_removed",
    channelId,
    userId,
  }),
  workspaceUpdated: (): WorkspaceEvent => ({ kind: "workspace.updated" }),
  directoryUpdated: (): WorkspaceEvent => ({ kind: "directory.updated" }),
} as const;

/**
 * The user-scoped (DUAL-ROUTE) builder catalog — targeted structural events sent
 * to a specific user over their always-on socket via `emitUserEvents`, so they
 * react even when not on the affected workspace's socket.
 */
export const UserEvents = {
  workspaceDeleted: (workspaceId: string): UserEvent => ({ kind: "workspace.deleted", workspaceId }),
  channelAdded: (workspaceId: string, channelId: string): UserEvent => ({
    kind: "channel.added",
    workspaceId,
    channelId,
  }),
  channelRemoved: (workspaceId: string, channelId: string): UserEvent => ({
    kind: "channel.removed",
    workspaceId,
    channelId,
  }),
  dmCreated: (workspaceId: string, channelId: string): UserEvent => ({
    kind: "dm.created",
    workspaceId,
    channelId,
  }),
} as const;

/**
 * Broadcast a workspace event to every socket connected to the workspace.
 * Best-effort: a backplane hiccup is logged, not thrown (clients self-heal).
 */
export async function emitWorkspaceEvent(
  workspaceId: string,
  event: WorkspaceEvent,
): Promise<void> {
  try {
    await hub.publish(workspaceId, event);
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, workspaceId, kind: event.kind },
      "realtime: workspace event publish failed (clients will self-heal on next load)",
    );
  }
}

/**
 * Deliver user-scoped events to specific users over their always-on socket — the
 * DUAL-ROUTE path for targeted events (e.g. "you were removed", "you were added
 * to a private channel") so the target reacts even when not on the workspace
 * socket. One backplane round-trip for the whole batch. Best-effort.
 */
export async function emitUserEvents(
  entries: ReadonlyArray<{ userId: string; event: UserEvent }>,
): Promise<void> {
  if (entries.length === 0) return;
  try {
    await hub.publishToUsers(entries);
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, count: entries.length },
      "realtime: user event publish failed (clients will self-heal on next load)",
    );
  }
}

/**
 * The COMPLETE map of workspace actions — the single source of truth for which
 * mutations exist and how each propagates. `realtime` names the live transport
 * (`workspace:*` = workspace-socket broadcast; `user:*` = dual-routed to specific
 * users' always-on sockets; `none` = not broadcast); `audit` names the forensic
 * event (or `none`).
 *
 * This is documentation (it drives no code) so the taxonomy lives beside the
 * builders/dispatchers rather than scattered across modules.
 */
export const WORKSPACE_ACTIONS = {
  // ── Roster ───────────────────────────────────────────────────────────────
  "member.added": { realtime: "workspace:member.added", audit: "member.added" },
  "member.removed": { realtime: "workspace:member.removed", audit: "member.removed" },
  "member.left": { realtime: "workspace:member.removed", audit: "member.left" },
  "member.role_changed": { realtime: "workspace:member.role_changed", audit: "member.role_changed" },
  "member.invited": { realtime: "none", audit: "member.invited" },
  // ── Channel lifecycle ─────────────────────────────────────────────────────
  "channel.created": { realtime: "workspace:channel.created", audit: "channel.created" },
  "channel.renamed": { realtime: "workspace:channel.updated", audit: "channel.renamed" },
  "channel.topic_changed": { realtime: "workspace:channel.updated", audit: "channel.renamed" },
  "channel.archived": { realtime: "workspace:channel.updated", audit: "channel.archived" },
  "channel.deleted": { realtime: "workspace:channel.deleted", audit: "channel.deleted" },
  // ── Channel membership ─────────────────────────────────────────────────────
  "channel.member_added": {
    realtime: "user:channel.added + workspace:channel.updated",
    audit: "none",
  },
  "channel.member_removed": {
    realtime: "user:channel.removed + workspace:channel.updated",
    audit: "none",
  },
  "channel.member_joined": { realtime: "workspace:channel.updated", audit: "none" },
  "channel.member_left": { realtime: "workspace:channel.updated", audit: "none" },
  // ── Direct messages ────────────────────────────────────────────────────────
  "dm.created": { realtime: "user:dm.created", audit: "none" },
  // ── Workspace lifecycle ────────────────────────────────────────────────────
  "workspace.renamed": { realtime: "workspace:workspace.updated", audit: "workspace.renamed" },
  "workspace.deleted": { realtime: "user:workspace.deleted", audit: "workspace.deleted" },
  // ── Profile ────────────────────────────────────────────────────────────────
  "profile.updated": { realtime: "workspace:directory.updated", audit: "none" },
} as const;
