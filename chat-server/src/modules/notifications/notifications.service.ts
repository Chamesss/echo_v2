import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { controlDb } from "../../infrastructure/database/control/client.js";
import {
  memberships,
  notificationSettings,
  notifications,
  users,
} from "../../infrastructure/database/control/schema.js";
import { withTenantSchema } from "../../infrastructure/database/tenant/client.js";
import type { NotificationWire } from "../../infrastructure/realtime/protocol.js";

/**
 * The notification inbox — the persistent half of the awareness layer.
 *
 * Lives in the control plane (not a tenant schema) so the cross-workspace inbox
 * is one query on `user_id`. `channelId`/`messageId` are bare references into the
 * workspace's tenant schema (no cross-schema FK); the inbox doesn't need to read
 * them, only to navigate there on click. Actor identity is joined live from
 * control `users`, so a renamed sender shows their current name.
 *
 * Every message creates a notification (`type: 'message'` for channels, `'dm'`
 * for direct messages) for each recipient who has notifications ENABLED for the
 * workspace. `important` + `'mention'` are reserved for the future tag system.
 *
 * NOTE (scale): this persists one row per recipient per message. Fine at MVP /
 * internal-tool scale; a busy large channel would want this trimmed (retention,
 * or deriving non-DM activity instead of persisting) before true enterprise load.
 */

function toWire(row: {
  id: string;
  type: string;
  workspaceId: string;
  channelId: string;
  channelName: string | null;
  messageId: string;
  actorId: string;
  actorName: string;
  actorImage: string | null;
  important: boolean;
  createdAt: Date;
  seenAt: Date | null;
  readAt: Date | null;
}): NotificationWire {
  return {
    id: row.id,
    type: row.type === "dm" ? "dm" : row.type === "mention" ? "mention" : "message",
    workspaceId: row.workspaceId,
    channelId: row.channelId,
    channelName: row.channelName,
    messageId: row.messageId,
    actorId: row.actorId,
    actorName: row.actorName,
    actorImage: row.actorImage,
    important: row.important,
    createdAt: row.createdAt.toISOString(),
    seenAt: row.seenAt ? row.seenAt.toISOString() : null,
    readAt: row.readAt ? row.readAt.toISOString() : null,
  };
}

/** A persisted notification paired with the recipient it was created for. */
export interface RecipientNotification {
  recipientId: string;
  notification: NotificationWire;
}

/**
 * Of the given recipients, the subset who have notifications ENABLED for the
 * workspace (a missing settings row defaults to enabled). Used to gate the inbox
 * + toast fan-out; unread counts are NOT gated here.
 */
export async function notifiableRecipients(
  recipientIds: string[],
  workspaceId: string,
): Promise<string[]> {
  if (recipientIds.length === 0) return [];
  const disabled = await controlDb
    .select({ userId: notificationSettings.userId })
    .from(notificationSettings)
    .where(
      and(
        eq(notificationSettings.workspaceId, workspaceId),
        eq(notificationSettings.enabled, false),
        inArray(notificationSettings.userId, recipientIds),
      ),
    );
  const off = new Set(disabled.map((r) => r.userId));
  return recipientIds.filter((id) => !off.has(id));
}

/**
 * Insert one notification per recipient and return them paired with their
 * recipient (so the caller can publish `notification.created` to each user's
 * awareness stream). Resolves the actor's name/image once.
 */
export async function createMessageNotifications(
  recipientIds: string[],
  base: {
    workspaceId: string;
    channelId: string;
    channelName: string | null;
    messageId: string;
    actorId: string;
    type: "message" | "dm";
  },
): Promise<RecipientNotification[]> {
  if (recipientIds.length === 0) return [];

  const [actor] = await controlDb
    .select({ name: users.name, image: users.image })
    .from(users)
    .where(eq(users.id, base.actorId))
    .limit(1);
  if (!actor) return [];

  const rows = await controlDb
    .insert(notifications)
    .values(
      recipientIds.map((userId) => ({
        userId,
        workspaceId: base.workspaceId,
        type: base.type,
        actorId: base.actorId,
        channelId: base.channelId,
        channelName: base.channelName,
        messageId: base.messageId,
      })),
    )
    .returning({
      id: notifications.id,
      userId: notifications.userId,
      createdAt: notifications.createdAt,
    });

  return rows.map((r) => ({
    recipientId: r.userId,
    notification: {
      id: r.id,
      type: base.type,
      workspaceId: base.workspaceId,
      channelId: base.channelId,
      channelName: base.channelName,
      messageId: base.messageId,
      actorId: base.actorId,
      actorName: actor.name,
      actorImage: actor.image ?? null,
      important: false,
      createdAt: r.createdAt.toISOString(),
      seenAt: null,
      readAt: null,
    },
  }));
}

/** Recent inbox for a user across all workspaces (newest first). */
export async function listNotifications(
  userId: string,
  opts: { limit: number; before?: string },
): Promise<NotificationWire[]> {
  const where = opts.before
    ? and(eq(notifications.userId, userId), lt(notifications.createdAt, new Date(opts.before)))
    : eq(notifications.userId, userId);

  const rows = await controlDb
    .select({
      id: notifications.id,
      type: notifications.type,
      workspaceId: notifications.workspaceId,
      channelId: notifications.channelId,
      channelName: notifications.channelName,
      messageId: notifications.messageId,
      actorId: notifications.actorId,
      actorName: users.name,
      actorImage: users.image,
      important: notifications.important,
      createdAt: notifications.createdAt,
      seenAt: notifications.seenAt,
      readAt: notifications.readAt,
    })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.actorId))
    .where(where)
    .orderBy(desc(notifications.createdAt))
    .limit(opts.limit);

  return rows.map(toWire);
}

export interface WorkspaceSummary {
  workspaceId: string;
  /** Sum of `last_seq − last_read_seq` across the user's channels in this workspace. */
  unread: number;
  /** Unread (not-yet-read) notification count for this workspace. */
  notifications: number;
}

export interface NotificationSummary {
  /** Notifications not yet seen — drives the global bell badge. */
  unseen: number;
  workspaces: WorkspaceSummary[];
}

/**
 * Cross-everything badge seed. Sums each workspace's unread (tenant fan-out,
 * bounded by the user's workspace count) and folds in per-workspace + global
 * notification counts. Live `unread.bump` / `notification.created` events keep
 * these numbers moving without a refetch after this initial load.
 */
export async function getSummary(userId: string): Promise<NotificationSummary> {
  const mems = await controlDb
    .select({ workspaceId: memberships.workspaceId })
    .from(memberships)
    .where(eq(memberships.userId, userId));

  const [unseenRow] = await controlDb
    .select({ unseen: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.seenAt)));
  const unseen = unseenRow?.unseen ?? 0;

  const notifCounts = await controlDb
    .select({ workspaceId: notifications.workspaceId, count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .groupBy(notifications.workspaceId);
  const notifByWs = new Map(notifCounts.map((r) => [r.workspaceId, r.count]));

  const workspaces: WorkspaceSummary[] = [];
  for (const m of mems) {
    workspaces.push({
      workspaceId: m.workspaceId,
      unread: await unreadForWorkspace(m.workspaceId, userId),
      notifications: notifByWs.get(m.workspaceId) ?? 0,
    });
  }

  return { unseen, workspaces };
}

async function unreadForWorkspace(workspaceId: string, userId: string): Promise<number> {
  return withTenantSchema(workspaceId, async (db) => {
    const { rows } = await db.query<{ unread: number }>(
      `SELECT COALESCE(SUM(GREATEST(c.last_seq - cm.last_read_seq, 0)), 0)::int AS unread
         FROM channel_members cm
         JOIN channels c ON c.id = cm.channel_id
        WHERE cm.user_id = $1 AND c.archived = false`,
      [userId],
    );
    return rows[0]?.unread ?? 0;
  });
}

/** Mark every unseen notification seen (clears the global dot). Returns the count touched. */
export async function markAllSeen(userId: string): Promise<number> {
  const updated = await controlDb
    .update(notifications)
    .set({ seenAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.seenAt)))
    .returning({ id: notifications.id });
  return updated.length;
}

/**
 * Mark notifications read. Scope by explicit ids, by channel (when a DM is
 * opened), or all. Only ever touches the caller's own rows.
 */
export async function markRead(
  userId: string,
  scope: { ids?: string[]; channelId?: string; all?: boolean },
): Promise<number> {
  const conds = [eq(notifications.userId, userId), isNull(notifications.readAt)];
  if (scope.all) {
    // no extra predicate
  } else if (scope.channelId) {
    conds.push(eq(notifications.channelId, scope.channelId));
  } else if (scope.ids && scope.ids.length > 0) {
    conds.push(inArray(notifications.id, scope.ids));
  } else {
    return 0; // nothing addressed
  }

  const updated = await controlDb
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(...conds))
    .returning({ id: notifications.id });
  return updated.length;
}

// ─── Per-workspace notification preferences ───────────────────────────────────

/** Whether the user has notifications enabled for a workspace (default: true). */
export async function getNotificationEnabled(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const [row] = await controlDb
    .select({ enabled: notificationSettings.enabled })
    .from(notificationSettings)
    .where(
      and(
        eq(notificationSettings.userId, userId),
        eq(notificationSettings.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return row?.enabled ?? true;
}

/** Upsert the user's notification preference for a workspace. */
export async function setNotificationEnabled(
  userId: string,
  workspaceId: string,
  enabled: boolean,
): Promise<void> {
  await controlDb
    .insert(notificationSettings)
    .values({ userId, workspaceId, enabled })
    .onConflictDoUpdate({
      target: [notificationSettings.userId, notificationSettings.workspaceId],
      set: { enabled },
    });
}
