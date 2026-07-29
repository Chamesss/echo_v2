import { useLocation } from "react-router";

// `/dashboard/:workspaceId(/channels/:channelId)` — the workspace shell route.
const ROUTE_RE = /\/dashboard\/([^/]+)(?:\/channels\/([^/]+))?/;

/**
 * The conversation the user is currently looking at, parsed from the URL — the
 * single source of "what's active". Used to enforce the rule that *the channel
 * you're viewing has zero unread to you*: its badge is hidden and it's excluded
 * from the workspace roll-up (it's about to be marked read), which also removes
 * the on-load flicker of a count that immediately clears.
 */
export function useActiveConversation(): {
  workspaceId: string | null;
  channelId: string | null;
} {
  const { pathname } = useLocation();
  const m = pathname.match(ROUTE_RE);
  return { workspaceId: m?.[1] ?? null, channelId: m?.[2] ?? null };
}
