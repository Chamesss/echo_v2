import { eq } from "drizzle-orm";
import { controlDb } from "../database/control/client.js";
import { memberships } from "../database/control/schema.js";
import { logger } from "../../shared/logger/logger.js";
import { hub } from "./hub.js";

/**
 * Online presence, derived from the awareness socket.
 *
 * "Online" means the hub holds at least one live `/ws/user` socket for the user.
 * There is no table and no heartbeat write — the socket registry IS the state.
 * This module owns the two things the hub deliberately doesn't:
 *
 *  1. WHO to tell. Presence is only visible to people who share a workspace with
 *     you, so a transition fans out to `rt_ws_<id>` for each workspace the user
 *     belongs to. Authorization is implicit: only a member can open that
 *     workspace's socket, so presence can't leak to a non-member.
 *
 *  2. WHEN "offline" is real. A page refresh tears the socket down and builds a
 *     new one a moment later; React StrictMode does the same on every mount in
 *     dev. Announcing offline immediately would flicker every avatar in the
 *     workspace on every refresh — so the offline edge is held for a grace
 *     window and cancelled if they come back inside it.
 *
 * Best-effort like every other dispatcher here: failures are logged, never
 * thrown into a socket lifecycle handler. Clients re-read `GET /presence` on
 * reconnect, so a dropped announcement self-heals.
 */

const OFFLINE_GRACE_MS = 8_000;

/** userId → pending "went offline" timer. */
const pendingOffline = new Map<string, ReturnType<typeof setTimeout>>();

/** An awareness socket opened. `wasFirst` is `hub.addUserSocket`'s return. */
export function onUserConnected(userId: string, wasFirst: boolean): void {
  const timer = pendingOffline.get(userId);
  if (timer) {
    // Back inside the grace window. Nobody was ever told they left, so cancel
    // the countdown and stay silent — re-announcing online would be a redundant
    // frame describing a state the clients already hold.
    clearTimeout(timer);
    pendingOffline.delete(userId);
    return;
  }
  if (wasFirst) void announce(userId, true);
}

/** An awareness socket closed. `wasLast` is `hub.removeUserSocket`'s return. */
export function onUserDisconnected(userId: string, wasLast: boolean): void {
  if (!wasLast) return; // other tabs still open
  if (pendingOffline.has(userId)) return; // already counting down
  const timer = setTimeout(() => {
    pendingOffline.delete(userId);
    // Re-check: a socket may have arrived after this timer was scheduled but
    // before it fired (a slow reconnect that raced the clear above).
    if (!hub.isOnline(userId)) void announce(userId, false);
  }, OFFLINE_GRACE_MS);
  pendingOffline.set(userId, timer);
}

async function announce(userId: string, online: boolean): Promise<void> {
  try {
    const rows = await controlDb
      .select({ workspaceId: memberships.workspaceId })
      .from(memberships)
      .where(eq(memberships.userId, userId));

    await hub.publishToWorkspaces(
      rows.map((r) => r.workspaceId),
      {
        kind: "presence.changed",
        userId,
        online,
      },
    );
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, userId, online },
      "presence: announce failed (clients self-heal on next load/reconnect)",
    );
  }
}
