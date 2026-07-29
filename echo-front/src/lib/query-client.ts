import { QueryClient } from '@tanstack/react-query';

/**
 * Shared TanStack Query client.
 *
 * Mounted once at the root by `providers/app-providers.tsx`. Every
 * `useQuery` / `useMutation` in the app talks to this instance, so cache
 * invalidations from one feature can flow into another (e.g. creating a
 * workspace invalidates `useMyWorkspaces`).
 *
 * Defaults tuned for a logged-in dashboard app:
 *   - 60s stale time avoids refetching on every component remount
 *   - retry 1x only — failures usually mean real problems, not transient noise
 *   - no refetch on window focus — feels intrusive in a chat UI
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
