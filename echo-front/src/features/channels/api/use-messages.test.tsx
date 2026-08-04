import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the HTTP layer so we can assert URLs + drive responses.
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn().mockResolvedValue({ lastReadSeq: 5 }) }));
import { apiFetch } from "@/lib/api";
import { historyKey, messagesKey } from "./keys";
import {
  useDiscardFailed,
  useMarkRead,
  useMessages,
  useRetrySend,
  useSendMessage,
} from "./use-messages";
import type { EchoMessage } from "../realtime/message-cache";

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

/**
 * A send that fails used to be a dead end: no retry, not deletable, and the
 * composer had already cleared the text. The retry is safe by construction —
 * `clientId` is the server's idempotency key, unique on `(channel_id,
 * client_id)` — so replaying it returns the existing row rather than creating a
 * second one. These assert that the SAME key is replayed; the exactly-once
 * guarantee itself is covered server-side in `reconnect.test.ts`.
 */
describe("failed send recovery", () => {
  const rows = (qc: QueryClient) =>
    qc.getQueryData<EchoMessage[]>(messagesKey("w1", "c1")) ?? [];

  async function sendAndFail(qc: QueryClient) {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useSendMessage("w1", "c1", "me"), {
      wrapper: clientWrapper(qc),
    });
    result.current.mutate({
      body: "hello",
      attachments: [{ key: "k1", filename: "a.png" }],
      optimisticAttachments: [],
    });
    await waitFor(() => expect(rows(qc).some((m) => m.failed)).toBe(true));
    return rows(qc).find((m) => m.failed)!;
  }

  it("marks the row failed and keeps its send refs for a replay", async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const failed = await sendAndFail(qc);

    expect(failed.pending).toBe(false);
    expect(failed.body).toBe("hello");
    // Rendered attachments carry preview URLs and can't be replayed to the API;
    // the original refs are what a retry needs.
    expect(failed.sendRefs).toEqual([{ key: "k1", filename: "a.png" }]);
  });

  it("retries with the ORIGINAL clientId so the server dedupes it", async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const failed = await sendAndFail(qc);
    vi.mocked(apiFetch).mockClear();
    vi.mocked(apiFetch).mockResolvedValueOnce({
      ...failed,
      id: "server-id",
      seq: 4,
      updatedSeq: 4,
      pending: undefined,
      failed: undefined,
    });

    const { result } = renderHook(() => useRetrySend("w1", "c1"), {
      wrapper: clientWrapper(qc),
    });
    result.current.mutate(failed);

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/workspaces/w1/channels/c1/messages",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          clientId: failed.clientId,
          body: "hello",
          attachments: [{ key: "k1", filename: "a.png" }],
        }),
      }),
    );

    // The optimistic row is replaced, not duplicated.
    await waitFor(() => expect(rows(qc).filter((m) => m.clientId === failed.clientId)).toHaveLength(1));
    await waitFor(() => expect(rows(qc)[0]!.failed).toBeFalsy());
  });

  it("discards a failed row locally without calling the API", async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const failed = await sendAndFail(qc);
    vi.mocked(apiFetch).mockClear();

    const { result } = renderHook(() => useDiscardFailed("w1", "c1"), {
      wrapper: clientWrapper(qc),
    });
    result.current(failed.clientId);

    expect(rows(qc)).toHaveLength(0);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
