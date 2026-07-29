import { createBrowserRouter, RouterProvider } from "react-router";
import { LoadingScreen } from "@/components/loading-screen";
import { RootLayout } from "@/components/layout/root-layout";
import { WorkspaceLayout } from "@/components/layout/workspace-layout";
import { RouteError } from "@/components/route-error";
import { RequireAuth } from "@/features/auth/guards/RequireAuth";
import { RequireAdmin } from "@/features/admin/guards/RequireAdmin";
import { lazyRoute } from "@/lib/lazy-route";

/**
 * Application route tree — a nested layout hierarchy:
 *
 *   RootLayout (cross-cutting hooks + impersonation banner + error boundary)
 *   ├─ public auth pages (no shell)
 *   └─ RequireAuth                              ← guards the whole signed-in app
 *      ├─ "/"                  index redirector → a workspace or /workspaces/create
 *      ├─ /workspaces/create   focused single-task page (no sidebar)
 *      └─ WorkspaceLayout  /dashboard/:workspaceId   ← sidebar shell + workspace ctx
 *         ├─ index            workspace home
 *         ├─ settings         account settings (inside the shell)
 *         └─ RequireAdmin → admin   admin dashboard (inside the shell)
 *
 * Guards (`RequireAuth`, `RequireAdmin`) and layouts (`WorkspaceLayout`) are
 * layout routes that render an `<Outlet/>`, so a whole subtree is gated/wrapped
 * in one place rather than per page. Page components are code-split via
 * `lazyRoute` (each route's module is fetched only on navigation).
 */
const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    // Every page is code-split, so on a cold load the router has to resolve the
    // matched route's `lazy()` before it can render anything. Without a fallback
    // it renders null for that beat (and warns); reuse the same spinner the auth
    // guards show, so "fetching the page chunk" and "resolving the session" look
    // like one continuous load instead of a blank flash between them.
    HydrateFallback: LoadingScreen,
    children: [
      // ── Public / unauthenticated ──────────────────────────────────────────
      { path: "/login", lazy: lazyRoute(() => import("@/routes/auth/login")) },
      { path: "/register", lazy: lazyRoute(() => import("@/routes/auth/register")) },
      {
        path: "/forgot-password",
        lazy: lazyRoute(() => import("@/routes/auth/forgot-password")),
      },
      {
        path: "/reset-password",
        lazy: lazyRoute(() => import("@/routes/auth/reset-password")),
      },
      // Invite acceptance is PUBLIC: a logged-out invitee must be able to view it
      // and be routed into sign-up (carrying the token). The page itself handles
      // the logged-in / logged-out / email-mismatch states + auto-accept.
      {
        path: "accept-invite/:token",
        lazy: lazyRoute(() => import("@/routes/accept-invite")),
      },

      // ── Authenticated app ─────────────────────────────────────────────────
      {
        element: <RequireAuth />,
        children: [
          { index: true, lazy: lazyRoute(() => import("@/routes/index")) },
          {
            path: "workspaces/create",
            lazy: lazyRoute(() => import("@/routes/workspaces/create")),
          },

          // ── Inside a workspace (sidebar shell) ──────────────────────────────
          {
            path: "dashboard/:workspaceId",
            element: <WorkspaceLayout />,
            children: [
              { index: true, lazy: lazyRoute(() => import("@/routes/workspace/home")) },
              {
                path: "channels/:channelId",
                lazy: lazyRoute(() => import("@/routes/workspace/channel")),
              },
              { path: "members", lazy: lazyRoute(() => import("@/routes/workspace/members")) },
              {
                path: "workspace-settings",
                lazy: lazyRoute(() => import("@/routes/workspace/workspace-settings")),
              },
              { path: "settings", lazy: lazyRoute(() => import("@/routes/account")) },
              {
                element: <RequireAdmin />,
                children: [
                  { path: "admin", lazy: lazyRoute(() => import("@/routes/admin")) },
                ],
              },
              // Future: { path: "channels/:channelId", … }, { path: "options", … }
            ],
          },
        ],
      },
    ],
  },
]);

export function Router() {
  return <RouterProvider router={router} />;
}
