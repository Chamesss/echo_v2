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

/** A message as it appears on the wire (REST responses + socket events). */
export interface MessageWire {
  id: string;
  channelId: string;
  authorId: string;
  body: string;
  clientId: string;
  /** Creation ordinal — immutable, used for stable ordering + history paging. */
  seq: number;
  /** Channel clock at the last mutation — the reconciliation key. */
  updatedSeq: number;
  version: number;
  deleted: boolean;
  createdAt: string;
  updatedAt: string | null;
}

/**
 * A channel event. Message create/edit/delete carry `updatedSeq` and drive the
 * client's gap detection; `read` is an idempotent read-state broadcast that does
 * NOT consume the clock (so it never triggers a false gap).
 */
export type ChannelEvent =
  | { kind: "message.created"; channelId: string; updatedSeq: number; message: MessageWire }
  | { kind: "message.updated"; channelId: string; updatedSeq: number; message: MessageWire }
  | { kind: "message.deleted"; channelId: string; updatedSeq: number; message: MessageWire }
  | { kind: "channel.read"; channelId: string; userId: string; lastReadSeq: number };

/** Frames the server pushes to a client. */
export type ServerFrame =
  | { t: "event"; event: ChannelEvent }
  | { t: "subscribed"; channelIds: string[] }
  | { t: "pong" }
  | { t: "error"; message: string };

/** Frames a client sends to the server. (Writes go over REST, never here.) */
export type ClientFrame =
  | { t: "subscribe"; channelIds: string[] }
  | { t: "unsubscribe"; channelIds: string[] }
  | { t: "ping" };

/** Backplane channel name for a workspace's events (Postgres NOTIFY channel). */
export function workspaceNotifyChannel(workspaceId: string): string {
  return `rt_ws_${workspaceId}`;
}
