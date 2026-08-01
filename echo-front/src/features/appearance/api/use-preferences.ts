import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import {
  coercePreferences,
  type AppearancePreferences,
} from "../schema";

/** React Query key for the caller's UI preferences (user-scoped, not per-workspace). */
export const preferencesKey = ["preferences"] as const;

/**
 * Shared key for the update mutation, so each in-flight save can count its
 * siblings via `isMutating` — see `useUpdatePreferences`.
 */
const updatePreferencesKey = ["preferences", "update"] as const;

/**
 * The caller's appearance preferences.
 *
 * `enabled` is passed in rather than derived here so the provider can gate this
 * on an established session: the login, register, and accept-invite routes
 * render signed out, and firing this there would 401 on every mount and trip
 * the global unauthorized redirect. Signed-out pages theme from the local cache
 * instead.
 *
 * `staleTime: Infinity` because preferences only change through this client's
 * own mutation, which writes the cache directly — there's nothing to poll for.
 */
export function usePreferences(enabled: boolean) {
  return useQuery({
    queryKey: preferencesKey,
    queryFn: async () => {
      const { preferences } = await apiFetch<{ preferences: unknown }>(
        "/api/preferences",
      );
      // Coerce rather than trust: a server running a newer build may return a
      // preference this client doesn't know, and a corrupt row must not blow up
      // a render.
      return coercePreferences(preferences);
    },
    enabled,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/**
 * Updates one or more preferences.
 *
 * Optimistic: the cache is written before the request goes out so the theme
 * flips instantly on click, and rolled back if the write fails. The body is a
 * PARTIAL patch — sending only what changed is what stops a client from
 * clobbering preferences it doesn't know about (see the server's
 * `updatePreferences`).
 *
 * Only the LAST save may touch the cache once it settles. Clicking through
 * themes quickly puts several requests in flight at once, and they can resolve
 * out of order — so an earlier reply (or an earlier rollback snapshot) landing
 * after a newer optimistic write would stomp it, and since the provider applies
 * every cache write straight to <html>, that stomp is visible as the theme
 * snapping back and then forward again. `isMutating` counts this mutation too,
 * so "more than one" means a newer save is still pending and owns the result.
 */
export function useUpdatePreferences() {
  const qc = useQueryClient();
  const isSuperseded = () =>
    qc.isMutating({ mutationKey: updatePreferencesKey }) > 1;

  return useMutation({
    mutationKey: updatePreferencesKey,

    mutationFn: async (patch: Partial<AppearancePreferences>) => {
      const { preferences } = await apiFetch<{ preferences: unknown }>(
        "/api/preferences",
        { method: "PUT", body: patch },
      );
      return coercePreferences(preferences);
    },

    onMutate: async (patch) => {
      // Stop an in-flight GET from landing after our optimistic write and
      // reverting the UI to the pre-change value.
      await qc.cancelQueries({ queryKey: preferencesKey });
      const previous = qc.getQueryData<AppearancePreferences>(preferencesKey);
      if (previous) {
        qc.setQueryData<AppearancePreferences>(preferencesKey, {
          ...previous,
          ...patch,
        });
      }
      return { previous };
    },

    onError: (_err, _patch, context) => {
      // `previous` is a snapshot from before THIS save; restoring it once a
      // newer one has already written would undo that newer change too.
      if (context?.previous && !isSuperseded()) {
        qc.setQueryData(preferencesKey, context.previous);
      }
    },

    // Server response is authoritative — it has merged the patch over whatever
    // was stored, which may include fields this client never sent.
    onSuccess: (preferences) => {
      if (isSuperseded()) return;
      qc.setQueryData(preferencesKey, preferences);
    },
  });
}
