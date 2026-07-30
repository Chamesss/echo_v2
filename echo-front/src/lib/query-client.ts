import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

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
      // Retry once for genuinely transient failures, but NEVER for 401/403.
      // An auth failure is a state, not a blip: retrying can't fix it, and every
      // attempt makes `apiFetch` dispatch another `auth:unauthorized`. During
      // sign-out that doubled each request and each redirect event, turning a
      // brief race into a runaway loop (see `use-unauthorized-redirect`).
      retry: (failureCount, error) => {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          return false;
        }
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
  },
});
