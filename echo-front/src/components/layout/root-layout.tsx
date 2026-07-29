import { Outlet } from "react-router";
import { useUnauthorizedRedirect } from "@/hooks/use-unauthorized-redirect";
import { useSessionFocusRefresh } from "@/hooks/use-session-focus-refresh";
import { ImpersonationBanner } from "@/features/admin/components/ImpersonationBanner";

/**
 * Root layout wrapping every route in the application.
 *
 * Used to mount cross-cutting hooks that need access to the router and the
 * React Query client — neither of which is available in `AppProviders`
 * (because the QueryClient is created above the router, and `useNavigate`
 * only works inside the router tree).
 *
 * Current responsibilities:
 *   - `useUnauthorizedRedirect` — listens for 401 events from apiFetch and
 *     bounces the user to /login with the cache cleared
 *   - `useSessionFocusRefresh` — re-validates the Better Auth session when
 *     the tab regains focus
 *
 * Add anything new that needs the router or query client here; keep one-time
 * provider setup in `AppProviders`.
 */
export function RootLayout() {
  useUnauthorizedRedirect();
  useSessionFocusRefresh();
  // Viewport-height flex column: the impersonation banner (when shown) takes its
  // own row at the top and the routed content fills the rest. This keeps the
  // banner from pushing a fixed-height shell (AppShell) past the viewport and
  // causing a body scroll. `h-dvh` (not `h-screen`) tracks the mobile browser's
  // dynamic viewport so the bottom row isn't hidden behind the address bar.
  return (
    <div className="flex h-dvh flex-col bg-background">
      <ImpersonationBanner />
      <div className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
