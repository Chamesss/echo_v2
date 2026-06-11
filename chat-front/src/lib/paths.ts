/**
 * Typed route-path builders — the single source of truth for navigation.
 *
 * Use these everywhere instead of hand-written string literals (`navigate("/")`,
 * `to="/account"`, ``/dashboard/${id}``). One definition means a URL-shape change
 * is a one-line edit, and `:workspaceId`-style params can't be fat-fingered.
 *
 * These are for navigation (`<Link to>`, `navigate()`, `<Navigate to>`). The
 * route *patterns* (`"dashboard/:workspaceId"`, `"settings"`, …) live as literal
 * segments in `router.tsx`, where react-router needs the colon syntax.
 */
export const paths = {
  login: "/login",
  register: "/register",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",

  home: "/",
  workspaceCreate: "/workspaces/create",

  /** Workspace home. */
  workspace: (workspaceId: string) => `/dashboard/${workspaceId}`,
  /** A channel within the workspace shell. */
  workspaceChannel: (workspaceId: string, channelId: string) =>
    `/dashboard/${workspaceId}/channels/${channelId}`,
  /** Account settings, rendered inside the workspace shell. */
  workspaceSettings: (workspaceId: string) => `/dashboard/${workspaceId}/settings`,
  /** Admin dashboard, rendered inside the workspace shell (admin role only). */
  workspaceAdmin: (workspaceId: string) => `/dashboard/${workspaceId}/admin`,
} as const;
