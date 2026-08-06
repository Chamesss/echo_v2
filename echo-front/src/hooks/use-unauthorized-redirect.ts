import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth-client";
import { UNAUTHORIZED_EVENT } from "@/lib/api";

const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
];

/**
 * Listens for the `auth:unauthorized` event dispatched by `apiFetch` on any
 * 401 response.
 *
 * Mounted once at the root layout. On trigger:
 *   1. Re-validate the session so the route guards see it's dead
 *   2. Redirect to /login (unless we're already on a public auth page, which
 *      would create a loop)
 *   3. Clear the React Query cache so the next session can't see stale data
 *
 * This makes mid-session expiries graceful — the user lands on /login with
 * a fresh state instead of seeing confusing errors from queries that suddenly
 * stopped working.
 *
 * ORDER AND RE-ENTRANCY ARE LOAD-BEARING — both caused a real sign-out loop:
 *
 *   - The clear happens LAST, not first. `queryClient.clear()` drops the data
 *     out from under every MOUNTED observer, and an observer with no data
 *     refetches immediately. Clearing first therefore re-fired the very queries
 *     that had just 401'd (the rail's `useMyWorkspaces` +
 *     `useNotificationsSummary`, still mounted because the redirect hadn't
 *     rendered yet) → fresh 401s → this handler again → clear again. Clearing
 *     after the redirect means those observers are already unmounted.
 *
 *   - `running` collapses a burst into ONE pass. Several queries 401 at once,
 *     so this fired concurrently, and each call ran its own `refetch()`. A
 *     `get-session` issued BEFORE the cookie died could then resolve AFTER it
 *     and write a live session back into the atom — at which point
 *     RedirectIfAuthed bounced the user back into the app and the loop
 *     restarted. One in-flight revalidation at a time removes that race.
 *
 * Latency is why this only ever bit in production: locally the revalidation
 * round-trip beat the loop, so it self-terminated before anyone saw it.
 */
export function useUnauthorizedRedirect() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { refetch } = useSession();
  const running = useRef(false);

  useEffect(() => {
    const handler = async () => {
      if (running.current) return; // a sibling 401 is already handling this
      running.current = true;
      try {
        // Re-validate the session against the server so better-auth's session
        // atom (which `useSession` and the route guards read) reflects the now
        // dead session. `authClient.getSession()` does NOT update the atom —
        // only the atom's own `refetch` does. Without this, the cached "logged
        // in" atom makes RedirectIfAuthed bounce us straight back into the app,
        // which ping-pongs with this redirect ("Too many calls to History").
        // Await it so we navigate only once the atom is null.
        try {
          await refetch?.();
        } catch {
          // ignore — we redirect to /login regardless
        }
        const path = window.location.pathname;
        const onPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
        if (!onPublic) {
          void navigate("/login", { replace: true });
        }
        queryClient.clear();
      } finally {
        running.current = false;
      }
    };
    window.addEventListener(UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
  }, [navigate, queryClient, refetch]);
}
