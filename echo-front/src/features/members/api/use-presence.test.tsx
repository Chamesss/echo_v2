import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";

/**
 * The cache shape and the observed shape are different on purpose: the query
 * stores the raw `{ online: [...] }` envelope, and `select` turns it into a Set
 * on read. That split exists so `use-workspace-events` can patch the cache with
 * `setQueryData` — a patcher has to write what the queryFn wrote.
 *
 * These tests pin that contract down, because getting it wrong fails SILENTLY:
 * `select` would receive a Set, read `.online` off it, get `undefined`, and the
 * dots would just stop updating.
 */

const apiFetch = vi.fn();
vi.mock("@/lib/api", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { usePresence } from "./use-presence";
import { presenceKey } from "./keys";

const WS = "w1";

let qc: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  apiFetch.mockReset();
});

describe("usePresence", () => {
  it("fetches the workspace snapshot and exposes it as a Set", async () => {
    apiFetch.mockResolvedValue({ online: ["u1", "u2"] });

    const { result } = renderHook(() => usePresence(WS), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(apiFetch).toHaveBeenCalledWith(`/api/workspaces/${WS}/presence`);
    expect(result.current.data).toBeInstanceOf(Set);
    expect(result.current.data!.has("u1")).toBe(true);
    expect(result.current.data!.has("nobody")).toBe(false);
  });

  it("caches the ENVELOPE, so a setQueryData patch flows through select", async () => {
    apiFetch.mockResolvedValue({ online: ["u1"] });
    const { result } = renderHook(() => usePresence(WS), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    // The cache holds the array shape, not the Set…
    expect(qc.getQueryData(presenceKey(WS))).toEqual({ online: ["u1"] });

    // …so this is exactly what `use-workspace-events` does on presence.changed.
    qc.setQueryData(presenceKey(WS), { online: ["u1", "u2"] });

    await waitFor(() => expect(result.current.data!.has("u2")).toBe(true));
    expect(result.current.data).toBeInstanceOf(Set);
  });

  it("is undefined before it loads, so callers render no dot at all", async () => {
    apiFetch.mockReturnValue(new Promise(() => {})); // never settles
    const { result } = renderHook(() => usePresence(WS), { wrapper });
    expect(result.current.data).toBeUndefined();
  });
});
