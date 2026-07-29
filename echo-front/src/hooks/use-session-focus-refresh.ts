import { useEffect } from "react";
import { useSession } from "@/lib/auth-client";

/**
 * Re-validates the session when the tab regains focus.
 *
 * Mounted once at the root layout. Long-idle tabs (laptop closed for hours,
 * background tab on a different desktop) would otherwise keep showing
 * "signed in" UI after the session expired or was revoked from another device.
 *
 * Uses the session atom's own `refetch` — NOT `authClient.getSession()`, which
 * fetches `/get-session` but doesn't write back to the atom `useSession`
 * reads, so it wouldn't actually update the UI. `refetch` hits the server
 * (cookieCache is off, so it's DB-truth) and propagates to every `useSession()`
 * consumer, so a revoked session is detected and the guards redirect on focus.
 */
export function useSessionFocusRefresh() {
  const { refetch } = useSession();

  useEffect(() => {
    const handler = () => {
      if (!document.hidden) {
        void refetch?.();
      }
    };
    document.addEventListener("visibilitychange", handler);
    window.addEventListener("focus", handler);
    return () => {
      document.removeEventListener("visibilitychange", handler);
      window.removeEventListener("focus", handler);
    };
  }, [refetch]);
}
