import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { presenceKey } from "./keys";

/**
 * The wire shape of `GET /presence` — and deliberately the CACHE shape too.
 *
 * `use-workspace-events` patches this cache with `setQueryData` when a
 * `presence.changed` event arrives, and a patcher has to write the same shape
 * the query function wrote. Storing the derived Set instead would leave the
 * patch and the `select` below disagreeing about the type, which fails silently
 * rather than loudly. Envelope in, Set out.
 */
export interface PresenceResponse {
  online: string[];
}

/**
 * Hoisted, not inline. React Query memoizes `select` against the function's
 * IDENTITY, so an inline arrow would rebuild the Set on every render and hand
 * every consumer a fresh reference each time.
 */
const toSet = (data: PresenceResponse): Set<string> => new Set(data.online);

/**
 * Who's online in this workspace, as a Set for an O(1) `has()` at every avatar.
 *
 * Presence is derived from the awareness socket (`/ws/user`) and pushed as a
 * workspace event, so this snapshot only has to be correct on load — after that
 * the event stream keeps it current, and a reconnect re-reads it (see
 * `use-workspace-events`).
 *
 * `data` is `undefined` until it loads, which callers should pass straight
 * through to `UserAvatar`'s tri-state `online` prop: no dot at all beats a grey
 * "offline" dot that flips green a moment later.
 */
export function usePresence(workspaceId: string) {
  return useQuery({
    queryKey: presenceKey(workspaceId),
    queryFn: () =>
      apiFetch<PresenceResponse>(`/api/workspaces/${workspaceId}/presence`),
    select: toSet,
    staleTime: 30_000,
  });
}
