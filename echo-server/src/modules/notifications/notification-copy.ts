import type { NotificationWire } from "../../infrastructure/realtime/protocol.js";

/**
 * The single place that decides how a notification READS.
 *
 * This module is pure — no database, no imports beyond the wire type — so the
 * frontend imports it directly, the same way it already imports
 * `protocol.ts#isChannelEvent` at runtime. It lives beside the wire contract
 * rather than in the client because the contract is what it interprets, and
 * because email/push will eventually need the identical wording.
 *
 * It exists because the wording was written twice — once for the toast, once for
 * the notification tray — and neither copy knew what a group was. Both hardcoded
 * a `#` in front of `channelName`, which is the PUBLIC CHANNEL sigil, so the
 * moment named groups started sending their name a group conversation began
 * announcing itself as "#Project X". One renderer to change is the actual fix;
 * the stray `#` was only the symptom.
 */

/** How many names to spell out before collapsing the rest into "& N others". */
const DEFAULT_MAX_NAMES = 2;

/**
 * Human label for a set of people: "Bob", "Bob, Carol", "Bob, Carol & 2 others".
 *
 * `max` caps how many are named. Omit it to list everyone — that's what the
 * sidebar wants, where a conversation gets a full line to itself. The notif
 * fan-out caps it, because a nine-person label doesn't fit a toast.
 */
export function participantLabel(names: string[], max?: number): string {
  if (names.length === 0) return "";
  if (max === undefined || names.length <= max) return names.join(", ");

  const shown = names.slice(0, max).join(", ");
  const rest = names.length - max;
  return `${shown} & ${rest} ${rest === 1 ? "other" : "others"}`;
}

/** What a notification says, split so the toast and the tray render the same words. */
export interface NotificationCopy {
  /** Who it's from — the toast's heading, and the bolded name in the tray. */
  title: string;
  /** Where it happened, phrased for the tray ("posted in #general"). */
  body: string;
  /** The same fact phrased for a toast heading's subtitle. */
  toastBody: string;
}

/**
 * Describe one notification.
 *
 * Three shapes, told apart by fields the wire already carries — no protocol
 * change was needed:
 *
 *   - a CHANNEL (`type: 'message'`) keeps its `#`;
 *   - a GROUP (`type: 'dm'` WITH a `channelName`) is named without one, since
 *     `#` would claim it's a public channel;
 *   - a 1:1 (`type: 'dm'`, no name) needs no location at all — the sender IS the
 *     conversation.
 *
 * An unnamed group reaches here with a participant label in `channelName`,
 * derived per-recipient at send time. Before that it arrived as `null` and read
 * exactly like a private 1:1, so there was no way to tell whether someone had
 * written to you alone or in front of four other people.
 */
export function describeNotification(n: NotificationWire): NotificationCopy {
  const title = n.actorName;

  if (!n.channelName) {
    return { title, body: "sent you a message", toastBody: "Sent you a message" };
  }

  const where = n.type === "message" ? `#${n.channelName}` : n.channelName;
  return {
    title,
    body: `posted in ${where}`,
    toastBody: `New message in ${where}`,
  };
}

/**
 * Toast copy for several messages collapsed into one notification.
 *
 * A busy conversation used to fire one toast per message — an eight-person group
 * trading twenty messages produced twenty pop-ups. The provider now keeps one
 * toast per conversation and rewrites it in place, so this renders the running
 * total instead of a single sender.
 */
export function describeCoalesced(
  n: NotificationWire,
  actorNames: string[],
  count: number,
): NotificationCopy {
  if (count <= 1) return describeNotification(n);

  const who = participantLabel(actorNames, DEFAULT_MAX_NAMES);
  const many = `${who} · ${count} new`;

  // Titled by the conversation once it's plural — the sender is no longer the
  // headline when several people are talking.
  if (!n.channelName) {
    return { title: who, body: `${count} new messages`, toastBody: `${count} new messages` };
  }
  const where = n.type === "message" ? `#${n.channelName}` : n.channelName;
  return { title: where, body: many, toastBody: many };
}

export { DEFAULT_MAX_NAMES };
