import type {
  ClientFrame,
  RealtimeEvent,
} from "@server/infrastructure/realtime/protocol";
import { API_URL } from "@/config/env";
import { ReconnectingSocket } from "./reconnecting-socket";

export type { RealtimeStatus } from "./reconnecting-socket";

/**
 * One WebSocket connection to `/ws`, scoped to a single workspace.
 *
 * Responsibilities are deliberately narrow: re-assert the desired channel
 * subscriptions on every (re)open, and expose the typing frame. Connection
 * lifecycle — reconnect, backoff, liveness watchdog, wake triggers — lives in
 * `ReconnectingSocket`.
 *
 * It does NOT interpret events or touch any cache: gap detection, ordering, and
 * catch-up live in the reconciliation layer (`features/channels/realtime`),
 * because the socket is only an accelerator; the REST sequence is the source of
 * truth.
 *
 * Cookie auth rides the upgrade automatically (same-site), so there's no token
 * to manage here. Writes are never sent over the socket.
 */
export class WorkspaceRealtime extends ReconnectingSocket<
  ClientFrame,
  RealtimeEvent
> {
  private readonly desired = new Set<string>();

  constructor(private readonly workspaceId: string) {
    super();
  }

  protected buildUrl(): string {
    const base = API_URL.replace(/^http/, "ws"); // http→ws, https→wss
    return `${base}/ws?workspaceId=${encodeURIComponent(this.workspaceId)}`;
  }

  /** Re-assert every desired subscription (covers the reconnect case). */
  protected onOpened(): void {
    if (this.desired.size > 0) {
      this.sendFrame({ t: "subscribe", channelIds: [...this.desired] });
    }
  }

  subscribe(channelId: string): void {
    if (this.desired.has(channelId)) return;
    this.desired.add(channelId);
    this.sendFrame({ t: "subscribe", channelIds: [channelId] });
  }

  unsubscribe(channelId: string): void {
    if (!this.desired.delete(channelId)) return;
    this.sendFrame({ t: "unsubscribe", channelIds: [channelId] });
  }

  /**
   * Ephemeral typing signal — the only non-subscription frame we send (see the
   * note on `ClientFrame`: it isn't a write, so it doesn't belong on the REST
   * path that owns durability). `sendFrame` no-ops when the socket isn't OPEN,
   * which is exactly right here: a tick during a reconnect is simply dropped,
   * and the receiver's TTL cleans up after it.
   */
  typing(channelId: string, state: "start" | "stop"): void {
    this.sendFrame({ t: "typing", channelId, state });
  }
}
