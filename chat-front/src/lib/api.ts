import { API_URL } from "@/config/env";

/**
 * Custom event fired by `apiFetch` whenever a request comes back 401.
 *
 * Listened to by `useUnauthorizedRedirect` (mounted in the root layout) so a
 * mid-session expiry bounces the user to /login with the React Query cache
 * cleared. Using an event keeps `apiFetch` itself router-free — important
 * because the function runs outside React's context.
 */
export const UNAUTHORIZED_EVENT = "auth:unauthorized";

/**
 * Error thrown by `apiFetch` on any non-2xx response.
 *
 * React Query treats thrown promises as errors, so throwing this class flips
 * mutations/queries into their error state with structured details intact.
 * The `code` mirrors what the backend sends in `error.code` so the UI can
 * branch on specific failure modes (e.g., `slug_taken`).
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

/**
 * Thin fetch wrapper used by every React Query hook in `features/<x>/api/`.
 *
 * Adds four things the rest of the app doesn't have to repeat:
 *   - Base URL (API_URL — VITE_API_URL in dev, same-origin in prod)
 *   - `credentials: 'include'` so Better Auth's session cookie crosses origins
 *   - JSON serialization and non-2xx error throwing
 *   - 401 dispatch to the global unauthorized handler so any request that
 *     hits an expired session triggers a clean redirect to /login
 *
 * For auth flows (sign-in, sign-up, etc.), use the `authClient` from
 * `auth-client.ts` instead — it knows about Better Auth's response shapes.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;

  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  }

  if (response.status === 204) return undefined as T;

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string; issues?: unknown } })
      .error ?? {};
    throw new ApiError(
      response.status,
      error.code ?? "unknown_error",
      error.message ?? "Request failed",
      error.issues,
    );
  }

  return data as T;
}
