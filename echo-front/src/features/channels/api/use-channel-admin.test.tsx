import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which caches a channel-membership change has to refresh.
 *
 * `channelMembersKey` (the settings dialog's roster) is the obvious one and was
 * the only one anybody noticed. But a group conversation's avatars and names —
 * the sidebar stack, the header, its member count — all render from
 * `participants`, which arrives on the DM LIST. Refreshing only the roster and
 * the channel list left every one of those surfaces showing the old member set
 * until a reload.
 */

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

const { apiFetch } = await import("@/lib/api");
const { useAddChannelMember, useRemoveChannelMember } = await import("./use-channel-admin");
const { channelMembersKey, channelsKey } = await import("./keys");
const { dmsKey } = await import("./use-dms");

const WS = "w1";
const CH = "c1";

/** A client holding all three caches, so each one's invalidation is observable. */
function seeded() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(channelsKey(WS), []);
  qc.setQueryData(dmsKey(WS), []);
  qc.setQueryData(channelMembersKey(WS, CH), []);
  return qc;
}

const wrap = (qc: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };

const invalidated = (qc: QueryClient) => ({
  channels: qc.getQueryState(channelsKey(WS))?.isInvalidated,
  dms: qc.getQueryState(dmsKey(WS))?.isInvalidated,
  members: qc.getQueryState(channelMembersKey(WS, CH))?.isInvalidated,
});

beforeEach(() => {
  vi.mocked(apiFetch).mockReset().mockResolvedValue(undefined);
});

describe("useAddChannelMember", () => {
  it("refreshes the roster AND both conversation lists", async () => {
    const qc = seeded();
    const { result } = renderHook(() => useAddChannelMember(WS, CH), { wrapper: wrap(qc) });

    result.current.mutate("u2");

    await waitFor(() => expect(invalidated(qc).members).toBe(true));
    expect(invalidated(qc)).toEqual({ channels: true, dms: true, members: true });
  });
});

describe("useRemoveChannelMember", () => {
  it("refreshes the roster AND both conversation lists", async () => {
    const qc = seeded();
    const { result } = renderHook(() => useRemoveChannelMember(WS, CH), { wrapper: wrap(qc) });

    result.current.mutate("u2");

    await waitFor(() => expect(invalidated(qc).members).toBe(true));
    expect(invalidated(qc)).toEqual({ channels: true, dms: true, members: true });
  });
});
