import { withTenantSchema } from "../../infrastructure/database/tenant/client.js";
import { hub } from "../../infrastructure/realtime/hub.js";
import { UserEvents } from "../../infrastructure/realtime/events.js";
import type { MessageWire, UserEvent } from "../../infrastructure/realtime/protocol.js";
import { logger } from "../../shared/logger/logger.js";
import {
  createMessageNotifications,
  notifiableRecipients,
} from "../notifications/notifications.service.js";
import { participantLabel } from "../notifications/notification-copy.js";

/**
 * Awareness: everything that happens to OTHER people because a message was sent
 * — unread bumps, inbox notifications, DM discovery.
 *
 * Split from the message engine because the contracts differ: that half is
 * transactional and must not fail, this half is best-effort and detached. The
 * engine calls `trackFanOut(fanOutAwareness(...))` once and ignores the result.
 */

/**
 * Fan-outs still in flight, so something can wait for them.
 *
 * Detaching the fan-out from the send made it unobservable — the work is real
 * but nothing holds a handle to it. Two callers need one: a graceful shutdown,
 * which shouldn't drop notifications that were seconds from being written, and
 * tests, which would otherwise assert against a fan-out that hasn't run yet and
 * pass or fail on timing.
 */
const inFlightFanOuts = new Set<Promise<void>>();

export function trackFanOut(p: Promise<void>): void {
  inFlightFanOuts.add(p);
  // `then(cleanup, cleanup)` rather than `finally`, which would re-raise a
  // rejection with nothing left to catch it. `fanOutAwareness` swallows its own
  // errors today, so this is belt-and-braces — but an unhandled rejection from a
  // detached promise takes the whole process down, which is far too steep a
  // price for best-effort work.
  const forget = () => {
    inFlightFanOuts.delete(p);
  };
  p.then(forget, forget);
}

/** Wait for every in-flight awareness fan-out to settle. */
export async function drainAwarenessFanOut(): Promise<void> {
  // Snapshot per pass: settling one can't enqueue another (fan-out never sends),
  // but the loop costs nothing and removes the assumption.
  while (inFlightFanOuts.size > 0) {
    await Promise.allSettled([...inFlightFanOuts]);
  }
}

/** How many people a group's derived label names before "& N others". */
const GROUP_LABEL_MAX_NAMES = 2;

/**
 * The `channelName` snapshot stored on ONE recipient's notification.
 *
 * Per recipient, not per message, because the answer differs for each of them —
 * which is free, since a notification row is inserted per recipient anyway.
 *
 *   - a 1:1 gets `null`: the sender identifies the conversation, so a name would
 *     just repeat them;
 *   - a named group or channel gets its name;
 *   - an UNNAMED group gets a label built from the other people in it, with the
 *     reader excluded — otherwise you'd read your own name back. Without this a
 *     group message was indistinguishable from a private 1:1: both rendered
 *     "sent you a message", so you couldn't tell whether someone had written to
 *     you alone or in front of four other people.
 *
 * A snapshot, deliberately — renaming a group later leaves old notifications
 * reading as they did when they arrived, exactly as channels already behave.
 */
function notificationLabelFor(
  channelType: string,
  channelName: string | null,
  members: Array<{ userId: string; name: string }>,
  recipientId: string,
): string | null {
  if (channelType === "direct") return null;
  if (channelName) return channelName;
  if (channelType !== "group") return null;

  const others = members.filter((m) => m.userId !== recipientId).map((m) => m.name);
  return participantLabel(others, GROUP_LABEL_MAX_NAMES) || null;
}

/**
 * The awareness fan-out, fired AFTER the message is committed + the channel
 * broadcast sent. Pushes an `unread.bump` to every other member of the channel
 * (so their sidebar/workspace badges move without a reload) and, for DMs, also
 * persists an inbox notification + pushes `notification.created`.
 *
 * A DM's FIRST message also re-emits `dm.created`. `openOrCreateDm` already fires
 * that once, but it fires when the sender clicks "Start" in the picker — possibly
 * minutes before the message, and NOTIFY is at-most-once, so a recipient who was
 * disconnected/asleep at that instant never learned the conversation exists and
 * could only discover it by reloading. Re-emitting here puts discovery on the
 * durable path (the message itself). The client handler is a bare cache
 * invalidate, so receiving it twice is a no-op.
 *
 * Best-effort: the message is already durable and the primary broadcast is done,
 * so a hiccup here must never fail the send — errors are swallowed + logged, and
 * recipients' counts self-heal from the summary endpoint on their next load.
 * That contract is also why the caller doesn't await it.
 */
export async function fanOutAwareness(
  workspaceId: string,
  channelId: string,
  authorId: string,
  message: MessageWire,
): Promise<void> {
  try {
    // One round trip, not two: the channel row rides along with the member list
    // via a lateral-free join, and each member's NAME comes with them — needed
    // below to label an unnamed group. Previously this was two sequential
    // queries and no names.
    const { channelType, channelName, members } = await withTenantSchema(
      workspaceId,
      async (db) => {
        const { rows } = await db.query<{
          type: string;
          name: string | null;
          user_id: string | null;
          user_name: string | null;
        }>(
          `SELECT c.type, c.name, cm.user_id, u.name AS user_name
             FROM channels c
             LEFT JOIN channel_members cm ON cm.channel_id = c.id
             LEFT JOIN users u ON u.id = cm.user_id
            WHERE c.id = $1`,
          [channelId],
        );
        return {
          channelType: rows[0]?.type,
          channelName: rows[0]?.name ?? null,
          // Every member INCLUDING the author — the author is filtered out of the
          // recipients below, but their name still belongs in a group's label.
          members: rows
            .filter((r) => r.user_id !== null)
            .map((r) => ({ userId: r.user_id!, name: r.user_name ?? "" })),
        };
      },
    );

    const recipientIds = members.map((m) => m.userId).filter((id) => id !== authorId);
    if (!channelType || recipientIds.length === 0) return;
    const isDm = channelType === "direct" || channelType === "group";

    // Collect every awareness event for this message, then publish in ONE
    // backplane round-trip (instead of O(members) NOTIFYs).
    const entries: Array<{ userId: string; event: UserEvent }> = [];

    // Unread bumps go to ALL members (counts aren't gated by notification prefs).
    for (const rid of recipientIds) {
      entries.push({
        userId: rid,
        event: {
          kind: "unread.bump",
          workspaceId,
          channelId,
          channelType: isDm ? "dm" : "channel",
          updatedSeq: message.updatedSeq,
        },
      });
      // First message in a DM → also tell them the conversation exists (see the
      // note above). `seq === 1` is the conversation's opening message: seq is
      // the immutable creation ordinal off a gapless per-channel clock, so it
      // holds exactly once per DM and never on a retry (retries return the
      // existing row without reaching this fan-out).
      if (isDm && message.seq === 1) {
        entries.push({ userId: rid, event: UserEvents.dmCreated(workspaceId, channelId) });
      }
    }

    // Inbox notifications (bell + toast) go only to recipients who haven't
    // disabled notifications for this workspace. Every message earns one.
    const notifiable = await notifiableRecipients(recipientIds, workspaceId);
    if (notifiable.length > 0) {
      const created = await createMessageNotifications(
        notifiable.map((userId) => ({
          userId,
          channelName: notificationLabelFor(channelType, channelName, members, userId),
        })),
        {
          workspaceId,
          channelId,
          messageId: message.id,
          actorId: authorId,
          type: isDm ? "dm" : "message",
        },
      );
      for (const c of created) {
        entries.push({
          userId: c.recipientId,
          event: { kind: "notification.created", notification: c.notification },
        });
      }
    }

    await hub.publishToUsers(entries);
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, workspaceId, channelId },
      "awareness fan-out failed (message delivered; counts will self-heal on next load)",
    );
  }
}
