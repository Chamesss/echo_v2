import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "@/lib/api";
import { readsKey } from "./keys";
import { useChannelReads, upsertRead, type ChannelReadDTO } from "./use-reads";

function clientWrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => vi.mocked(apiFetch).mockReset());

describe("useChannelReads + live upsert (cache-shape consistency)", () => {
  // Guards the bug where the query stored the `{ reads }` envelope but the
  // realtime updater wrote a bare array — so receipts only appeared on refresh.
  it("reflects a live setQueryData upsert through the hook", async () => {
    const qc = new QueryClient();
    vi.mocked(apiFetch).mockResolvedValueOnce({ reads: [{ userId: "a", lastReadSeq: 1 }] });

    const { result } = renderHook(() => useChannelReads("w1", "c1"), {
      wrapper: clientWrapper(qc),
    });
    await waitFor(() => expect(result.current.data).toEqual([{ userId: "a", lastReadSeq: 1 }]));

    // Exactly what use-channel-stream does on a `channel.read` event:
    qc.setQueryData<ChannelReadDTO[]>(readsKey("w1", "c1"), (old) => upsertRead(old, "b", 5));

    await waitFor(() =>
      expect(result.current.data).toEqual([
        { userId: "a", lastReadSeq: 1 },
        { userId: "b", lastReadSeq: 5 },
      ]),
    );
  });
});
