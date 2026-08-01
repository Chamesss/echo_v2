import { hub } from "../../infrastructure/realtime/hub.js";
import { getDirectory } from "./directory.service.js";

/**
 * Which members of this workspace are online right now.
 *
 * The hub's registry is process-wide and NOT workspace-scoped, so it must be
 * intersected with the roster before it leaves the server — returning the raw
 * list would leak the existence of users from other workspaces.
 *
 * The roster comes from the cached directory (`userId → profile`, 60s TTL), so
 * this is a map lookup per online user and usually costs no query at all.
 */
export async function listOnlineMembers(
  workspaceId: string,
): Promise<string[]> {
  const directory = await getDirectory(workspaceId);
  return hub.onlineUserIds().filter((userId) => userId in directory);
}
