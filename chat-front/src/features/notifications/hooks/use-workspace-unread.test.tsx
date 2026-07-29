import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { channelsKey } from "@/features/channels/api/keys";
import { dmsKey, useDirectMessages } from "@/features/channels/api/use-dms";
import { notificationsSummaryKey } from "../api/keys";
import { useWorkspaceUnread } from "./use-workspace-unread";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: vi.fn().mockResolvedValue({ dms: [] }) };
});

import { apiFetch } from "@/lib/api";

const WS = "w1";

/** `route` sets the active conversation (drives the active-channel/ws rules). */
function harness(route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return { qc, wrapper };
}

const seedSummary = (qc: QueryClient, unread: number, notifications = 0) =>
  qc.setQueryData(notificationsSummaryKey, {
    unseen: 0,
    workspaces: [{ workspaceId: WS, unread, notifications }],
  });

describe("useWorkspaceUnread", () => {
  it("seeds from the summary for a workspace you're not in and haven't loaded", () => {
    const { qc, wrapper } = harness("/dashboard/other");
    seedSummary(qc, 3, 2);

    const { result } = renderHook(() => useWorkspaceUnread(WS), { wrapper });
    expect(result.current).toEqual({ unread: 3, notifications: 2 });
  });

  it("derives unread from the loaded lists, ignoring a stale summary", () => {
    const { qc, wrapper } = harness("/dashboard/other");
    seedSummary(qc, 9, 1); // stale-high (a resurrected count)
    qc.setQueryData(channelsKey(WS), [
      { id: "c1", unread: 2 },
      { id: "c2", unread: 0 },
    ]);
    qc.setQueryData(dmsKey(WS), [{ id: "d1", unread: 1 }]);

    const { result } = renderHook(() => useWorkspaceUnread(WS), { wrapper });
    expect(result.current).toEqual({ unread: 3, notifications: 1 });
  });

  it("excludes the channel you're actively viewing from the roll-up", () => {
    const { qc, wrapper } = harness(`/dashboard/${WS}/channels/c1`);
    seedSummary(qc, 0);
    qc.setQueryData(channelsKey(WS), [
      { id: "c1", unread: 5 }, // the open channel — about to be read, excluded
      { id: "c2", unread: 2 },
    ]);

    const { result } = renderHook(() => useWorkspaceUnread(WS), { wrapper });
    expect(result.current.unread).toBe(2);
  });

  it("shows 0 (no summary flash) for the active workspace while its lists load", () => {
    const { qc, wrapper } = harness(`/dashboard/${WS}/channels/c1`);
    seedSummary(qc, 5); // summary still counts the channel we're reading
    // lists NOT loaded yet

    const { result } = renderHook(() => useWorkspaceUnread(WS), { wrapper });
    expect(result.current.unread).toBe(0);
  });

  it("never fetches on its own", () => {
    const { qc, wrapper } = harness("/dashboard/other");
    seedSummary(qc, 1);

    renderHook(() => useWorkspaceUnread(WS), { wrapper });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("renders without React Query's missing-queryFn warning", () => {
    // `useBaseQuery` console.errors on every render of a queryFn-less useQuery,
    // `enabled: false` or not. The rail mounts two per workspace, so the dev
    // console filled with them. Passing the real fetcher is the documented fix.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { qc, wrapper } = harness("/dashboard/other");
    seedSummary(qc, 1);

    renderHook(() => useWorkspaceUnread(WS), { wrapper });

    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining("No queryFn was passed"));
    spy.mockRestore();
  });

  it("still lets the sidebar's query refetch on invalidation", async () => {
    // The rail renders last, so ITS options are the ones React Query stores for
    // the key and replays on refetch. Guards against those options going stale
    // or queryFn-less again.
    const { qc, wrapper } = harness("/dashboard/other");
    seedSummary(qc, 1);
    qc.setQueryData(dmsKey(WS), [{ id: "d1", unread: 1 }]);
    renderHook(
      () => {
        useDirectMessages(WS);
        return useWorkspaceUnread(WS);
      },
      { wrapper },
    );
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    vi.mocked(apiFetch).mockClear();

    await qc.refetchQueries({ queryKey: dmsKey(WS) });

    expect(apiFetch).toHaveBeenCalledWith(`/api/workspaces/${WS}/dms`);
    expect(qc.getQueryState(dmsKey(WS))?.status).toBe("success");
  });
});

afterEach(() => {
  vi.mocked(apiFetch).mockClear();
});
