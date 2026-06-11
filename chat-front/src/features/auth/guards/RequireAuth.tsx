import { useRef } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { useSession } from "@/lib/auth-client";
import { LoadingScreen } from "@/components/loading-screen";
import { paths } from "@/lib/paths";

/**
 * Auth gate for protected routes — used as a layout route in `router.tsx`, so it
 * guards an entire subtree (index, workspace create, and the whole workspace
 * shell) in one place rather than being wrapped around each page.
 *
 * While the session is resolving we show a full-screen spinner to avoid flashing
 * the unauthenticated state. If the user isn't signed in, redirect to /login and
 * remember where they were headed (`location.state.from`) for post-login return.
 */
export function RequireAuth() {
  const { data: session, isPending } = useSession();
  const location = useLocation();

  // Only show the full-screen spinner on the initial session load — not on
  // background refetches (focus refresh, post-mutation revalidation), where
  // better-auth sets `isPending` true again whenever `data === null`.
  // Otherwise every refetch would flash the spinner and unmount the page.
  const everResolved = useRef(false);
  if (!isPending) everResolved.current = true;

  if (isPending && !everResolved.current) return <LoadingScreen />;
  if (!session?.user) return <Navigate to={paths.login} state={{ from: location }} replace />;

  return <Outlet />;
}
