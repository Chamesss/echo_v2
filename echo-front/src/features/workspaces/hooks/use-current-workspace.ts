/**
 * Re-exported from the workspace context for a stable import path.
 *
 * `useCurrentWorkspace()` returns the current workspace (guaranteed non-null) for
 * anything rendered under `WorkspaceLayout` — the home page, settings, admin,
 * and future channels/messages views. The workspace is resolved + membership-
 * checked once by the layout, then served from context (no per-consumer refetch
 * or null-handling).
 */
export { useCurrentWorkspace } from "../context/workspace-context";
