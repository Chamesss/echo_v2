import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { channelsKey } from "@/features/channels/api/keys";
import { dmsKey } from "@/features/channels/api/use-dms";
import { notificationsSummaryKey } from "../api/keys";
import { useWorkspaceUnread } from "./use-workspace-unread";

const WS = "w1";

/** `route` sets the active conversation (drives the active-channel/ws rules). */
function harness(route: string) {
  const qc = new QueryClient();
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
});
