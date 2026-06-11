import { useEffect } from "react";
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
 *   1. Clear the React Query cache so the next session can't see stale data
 *   2. Redirect to /login (unless we're already on a public auth page, which
 *      would create a loop)
 *
 * This makes mid-session expiries graceful — the user lands on /login with
 * a fresh state instead of seeing confusing errors from queries that suddenly
 * stopped working.
 */
export function useUnauthorizedRedirect() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { refetch } = useSession();

  useEffect(() => {
    const handler = async () => {
      queryClient.clear();
      // Re-validate the session against the server so better-auth's session
      // atom (which `useSession` and the route guards read) reflects the now
      // dead session. `authClient.getSession()` does NOT update the atom — only
      // the atom's own `refetch` does. Without this, the cached "logged in"
      // atom makes RedirectIfAuthed bounce us straight back into the app, which
      // ping-pongs with this redirect (the "Too many calls to History" loop).
      // Await it so we navigate only once the atom is null.
      try {
        await refetch?.();
      } catch {
        // ignore — we redirect to /login regardless
      }
      const path = window.location.pathname;
      const onPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
      if (!onPublic) {
        navigate("/login", { replace: true });
      }
    };
    window.addEventListener(UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
  }, [navigate, queryClient, refetch]);
}
