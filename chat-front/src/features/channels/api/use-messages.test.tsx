import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the HTTP layer so we can assert URLs + drive responses.
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn().mockResolvedValue({ lastReadSeq: 5 }) }));
import { apiFetch } from "@/lib/api";
import { historyKey, messagesKey } from "./keys";
import { useMarkRead, useMessages } from "./use-messages";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** Wrapper bound to a provided client so the test can inspect the cache. */
function clientWrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const msgs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i}`, seq: i + 1, createdAt: new Date(i).toISOString() }));

beforeEach(() => vi.mocked(apiFetch).mockClear());

describe("useMarkRead", () => {
  it("posts to the channel-level /read route (NOT under /messages)", async () => {
    const { result } = renderHook(() => useMarkRead("w1", "c1"), { wrapper });
    result.current.mutate(7);

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/w1/channels/c1/read",
      expect.objectContaining({ method: "POST", body: { seq: 7 } }),
    );
  });
});

describe("useMessages has-older flag", () => {
  it("is false when the first page is short (no 'Load earlier')", async () => {
    const qc = new QueryClient();
    vi.mocked(apiFetch).mockResolvedValueOnce({ messages: msgs(3) });
    renderHook(() => useMessages("w1", "c1"), { wrapper: clientWrapper(qc) });

    await waitFor(() => expect(qc.getQueryData(messagesKey("w1", "c1"))).toBeDefined());
    expect(qc.getQueryData(historyKey("w1", "c1"))).toBe(false);
  });

  it("is true when the first page is full (older history may exist)", async () => {
    const qc = new QueryClient();
    vi.mocked(apiFetch).mockResolvedValueOnce({ messages: msgs(50) });
    renderHook(() => useMessages("w1", "c1"), { wrapper: clientWrapper(qc) });

    await waitFor(() => expect(qc.getQueryData(historyKey("w1", "c1"))).toBe(true));
  });
});
