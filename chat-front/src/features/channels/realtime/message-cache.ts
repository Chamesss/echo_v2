import type { MessageWire } from "@server/infrastructure/realtime/protocol";

/**
 * A message in the client cache. Extends the wire shape with optimistic-send
 * status so the composer can show "sending"/"failed" before the server confirms.
 */
export interface ChatMessage extends MessageWire {
  pending?: boolean;
  failed?: boolean;
}

// Optimistic messages have no real seq yet; park them at the bottom (newest)
// until the POST response swaps in the authoritative row + real seq.
export const OPTIMISTIC_SEQ = Number.MAX_SAFE_INTEGER;

/** Keep the list ascending by seq (creation order); createdAt breaks ties. */
export function sortMessages(list: ChatMessage[]): ChatMessage[] {
  return [...list].sort((a, b) => a.seq - b.seq || a.createdAt.localeCompare(b.createdAt));
}

/**
 * Merge one message into the list, the single rule the whole reconciliation
 * path funnels through:
 *   - matches an existing row (by server id OR optimistic clientId) → replace,
 *     unless the incoming version is older (stale edit → keep what we have);
 *   - otherwise insert only when `allowInsert` AND it isn't a delete (so we
 *     never materialize an orphaned old/edited/deleted message we never loaded).
 *
 * Live `message.created` and catch-up rows allow insert; live edits/deletes do
 * not (they only update something already on screen). Either way the caller
 * still advances its clock — "seen" is independent of "displayed".
 */
export function mergeMessage(
  list: ChatMessage[],
  msg: MessageWire,
  allowInsert: boolean,
): ChatMessage[] {
  const idx = list.findIndex((m) => m.id === msg.id || m.clientId === msg.clientId);
  if (idx >= 0) {
    const existing = list[idx]!;
    if (existing.id === msg.id && existing.version > msg.version) return list; // stale edit
    const next = list.slice();
    next[idx] = { ...msg };
    return sortMessages(next);
  }
  if (allowInsert && !msg.deleted) return sortMessages([...list, { ...msg }]);
  return list;
}

/** Build the optimistic row shown the instant a user hits send. */
export function optimisticMessage(input: {
  clientId: string;
  channelId: string;
  authorId: string;
  body: string;
}): ChatMessage {
  const now = new Date().toISOString();
  return {
    id: input.clientId, // temporary; replaced by the server id on confirm
    channelId: input.channelId,
    authorId: input.authorId,
    body: input.body,
    clientId: input.clientId,
    seq: OPTIMISTIC_SEQ,
    updatedSeq: OPTIMISTIC_SEQ,
    version: 1,
    deleted: false,
    createdAt: now,
    updatedAt: null,
    pending: true,
  };
}
