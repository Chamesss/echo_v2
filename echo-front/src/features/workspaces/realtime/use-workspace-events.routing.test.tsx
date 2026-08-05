import type { ReactNode } from "react";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeEvent } from "@server/infrastructure/realtime/protocol";

/**
 * What a workspace broadcast has to refresh in EVERY other session.
 *
 * The acting client refreshes itself from its mutation's `onSuccess`; every
 * other open tab learns about it only from these events. `channel.updated` is
 * the one the member-set changes ride on, and it carries a bare `channelId` —
 * which says nothing about whether the conversation lives in the channel list or
 * the DM list. Refreshing only `channelsKey` was silently wrong for every group:
 * their avatars, names and member count come from the DM list's `participants`,
 * so those surfaces kept rendering the old member set until a reload.
 */

let fire: ((e: RealtimeEvent) => void) | null = null;

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "me" } } }),
}));
vi.mock("@/features/workspaces/context/workspace-context", () => ({
  useCurrentWorkspace: () => ({ id: "w1", name: "WS", role: "member" }),
}));
vi.mock("@/features/channels/realtime/realtime-context", () => ({
  useRealtime: () => ({
    client: {
      onEvent: (l: (e: RealtimeEvent) => void) => {
        fire = l;
        return () => {
          fire = null;
        };
      },
      onStatus: () => () => {},
    },
    status: "open",
  }),
}));

const { useWorkspaceEvents } = await import("./use-workspace-events");
const { channelMembersKey, channelsKey } = await import("@/features/channels/api/keys");
const { dmsKey } = await import("@/features/channels/api/use-dms");
const { membersKey } = await import("@/features/members/api/keys");

const WS = "w1";
const CH = "c1";

function Harness() {
  useWorkspaceEvents();
  return <div>ok</div>;
}

/** Mounts the listener over a client already holding every cache we assert on. */
function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(channelsKey(WS), []);
  qc.setQueryData(dmsKey(WS), []);
  qc.setQueryData(channelMembersKey(WS, CH), []);
  qc.setQueryData(membersKey(WS), []);
  render(
    <Wrap qc={qc}>
      <Harness />
    </Wrap>,
  );
  return qc;
}

function Wrap({ qc, children }: { qc: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const stale = (qc: QueryClient, key: readonly unknown[]) =>
  qc.getQueryState(key)?.isInvalidated === true;

beforeEach(() => {
  fire = null;
});

describe("channel.updated", () => {
  it("refreshes the DM list, not just the channel list", async () => {
    // The reported bug: a group's participants live only on the DM list, so
    // adding or removing someone changed no avatar anywhere else.
    const qc = mount();

    fire!({ kind: "channel.updated", channelId: CH });

    await waitFor(() => expect(stale(qc, dmsKey(WS))).toBe(true));
    expect(stale(qc, channelsKey(WS))).toBe(true);
    expect(stale(qc, channelMembersKey(WS, CH))).toBe(true);
  });
});

describe("channel.deleted", () => {
  it("drops it from both lists", async () => {
    const qc = mount();

    fire!({ kind: "channel.deleted", channelId: CH });

    await waitFor(() => expect(stale(qc, dmsKey(WS))).toBe(true));
    expect(stale(qc, channelsKey(WS))).toBe(true);
  });
});

describe("member.removed", () => {
  it("refreshes the conversations the departed member was in", async () => {
    // Leaving the workspace cascades to `channel_members`, so they vanish from
    // every conversation — the same staleness as a per-channel removal.
    const qc = mount();

    fire!({ kind: "member.removed", userId: "someone-else" });

    await waitFor(() => expect(stale(qc, dmsKey(WS))).toBe(true));
    expect(stale(qc, channelsKey(WS))).toBe(true);
    expect(stale(qc, channelMembersKey(WS, CH))).toBe(true);
    expect(stale(qc, membersKey(WS))).toBe(true);
  });
});
