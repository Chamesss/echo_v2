import { createBrowserRouter, RouterProvider } from "react-router";
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
