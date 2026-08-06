import { Navigate, Outlet, useLocation } from "react-router";
import { useSession } from "@/lib/auth-client";
import { LoadingScreen } from "@/components/loading-screen";
import { paths } from "@/lib/paths";
import { useEverResolved } from "@/lib/use-ever-resolved";

/**
 * Gate for the /admin subtree — used as a layout route in `router.tsx`. Layered
 * on top of `RequireAuth`:
 *   - still resolving      → full-screen spinner (initial load only, mirrors
 *                            `RequireAuth` so refetches don't flash)
 *   - not signed in        → /login (remembering the intended destination)
 *   - signed in, not admin → "/" (no admin UI for regular users)
 *
 * "Admin" here means `users.role === 'admin'` — the same column the server's
 * admin plugin checks. This is a UX gate only; every `authClient.admin.*` call
 * is independently authorized server-side, so a non-admin who forces their way
 * to the route still can't perform any admin action.
 */
export function RequireAdmin() {
  const { data: session, isPending } = useSession();
  const everResolved = useEverResolved(isPending);
  const location = useLocation();


  if (isPending && !everResolved) return <LoadingScreen />;
  if (!session?.user) return <Navigate to={paths.login} state={{ from: location }} replace />;
  if (session.user.role !== "admin") return <Navigate to={paths.home} replace />;

  return <Outlet />;
}
