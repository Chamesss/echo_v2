import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { DEFAULT_PREFERENCES } from "../schema";

/**
 * Clicking through themes quickly puts several saves in flight at once, and
 * they can resolve OUT OF ORDER. Since `AppearanceProvider` applies every
 * preferences-cache write straight to <html>, a late reply from an earlier save
 * is not a silent inconsistency — it's a visible flicker: the theme snaps back
 * to the previous one, then forward again when the newer reply lands.
 */

const apiFetch = vi.fn();
vi.mock("@/lib/api", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { useUpdatePreferences, preferencesKey } from "./use-preferences";

let qc: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** A pending request whose resolution the test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(preferencesKey, { ...DEFAULT_PREFERENCES, theme: "default" });
  apiFetch.mockReset();
});

const themeInCache = () =>
  qc.getQueryData<typeof DEFAULT_PREFERENCES>(preferencesKey)!.theme;

describe("useUpdatePreferences — overlapping saves", () => {
  it("ignores an earlier reply that lands after a newer save", async () => {
    const first = deferred<{ preferences: unknown }>();
    const second = deferred<{ preferences: unknown }>();
    apiFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { result } = renderHook(() => useUpdatePreferences(), { wrapper });

    // `await`ed because `onMutate` cancels in-flight queries first, so the
    // optimistic write lands a microtask later rather than synchronously.
    await act(async () => void result.current.mutate({ theme: "aubergine" }));
    await act(async () => void result.current.mutate({ theme: "ochre" }));
    // Both optimistic writes have landed; the newest one wins.
    expect(themeInCache()).toBe("ochre");

    // The FIRST request now replies — out of order, carrying the older theme.
    await act(async () => {
      first.resolve({ preferences: { ...DEFAULT_PREFERENCES, theme: "aubergine" } });
      await first.promise;
    });

    // Without the guard this would be "aubergine" — the visible flicker.
    expect(themeInCache()).toBe("ochre");

    await act(async () => {
      second.resolve({ preferences: { ...DEFAULT_PREFERENCES, theme: "ochre" } });
      await second.promise;
    });
    expect(themeInCache()).toBe("ochre");
  });

  it("does not roll back a newer change when an earlier save fails", async () => {
    const first = deferred<{ preferences: unknown }>();
    const second = deferred<{ preferences: unknown }>();
    apiFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { result } = renderHook(() => useUpdatePreferences(), { wrapper });

    await act(async () => void result.current.mutate({ theme: "aubergine" }));
    await act(async () => void result.current.mutate({ theme: "ochre" }));

    await act(async () => {
      first.reject(new Error("network"));
      await first.promise.catch(() => {});
    });

    // The rollback snapshot predates "ochre"; restoring it would undo a change
    // the user made after the failing one.
    expect(themeInCache()).toBe("ochre");
  });

  it("still applies the server's answer for a lone save", async () => {
    // The merge matters: the server returns fields this client never sent.
    apiFetch.mockResolvedValue({
      preferences: { ...DEFAULT_PREFERENCES, theme: "aubergine", density: "compact" },
    });

    const { result } = renderHook(() => useUpdatePreferences(), { wrapper });
    act(() => result.current.mutate({ theme: "aubergine" }));

    await waitFor(() => expect(themeInCache()).toBe("aubergine"));
    expect(qc.getQueryData<typeof DEFAULT_PREFERENCES>(preferencesKey)!.density).toBe("compact");
  });

  it("still rolls back a lone failed save", async () => {
    apiFetch.mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => useUpdatePreferences(), { wrapper });
    act(() => result.current.mutate({ theme: "aubergine" }));

    await waitFor(() => expect(themeInCache()).toBe("default"));
  });
});
