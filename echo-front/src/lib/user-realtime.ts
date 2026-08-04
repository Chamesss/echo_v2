import type { UserClientFrame, UserEvent } from "@server/infrastructure/realtime/protocol";
import { API_URL } from "@/config/env";
import { ReconnectingSocket } from "./reconnecting-socket";

import type { RealtimeStatus } from "./reconnecting-socket";

export type UserRealtimeStatus = RealtimeStatus;

/**
 * The always-on **awareness** socket (`/ws/user`), scoped to the signed-in user
 * rather than a workspace. Sibling of `WorkspaceRealtime`, but thinner: it has no
 * channel subscriptions, so it adds nothing to `ReconnectingSocket` beyond its
 * URL. It surfaces typed `UserEvent`s (unread bumps + notifications) for *every*
 * workspace the user belongs to.
 *
 * Mounted once under `RequireAuth` so it survives navigation (including to the
 * dashboard, which holds no workspace socket). As with the workspace socket,
 * it's only an accelerator — authoritative counts come from the REST summary, so
 * a missed event self-heals on the next load/reconnect (status listeners fire a
 * resync on reconnect).
 *
 * The heartbeat that used to live here as an uncalled `ping()` is now owned by
 * the base class's liveness watchdog.
 */
export class UserRealtime extends ReconnectingSocket<UserClientFrame, UserEvent> {
  protected buildUrl(): string {
    const base = API_URL.replace(/^http/, "ws"); // http→ws, https→wss
    return `${base}/ws/user`;
  }
}
