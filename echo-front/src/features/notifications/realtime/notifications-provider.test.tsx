import { render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserEvent } from "@server/infrastructure/realtime/protocol";

/**
 * The awareness socket is an accelerator, not the source of truth — so the
 * behaviour that matters here is RECOVERY: what happens when an event names a
 * conversation the cached lists don't know about.
 *
 * That's the shape of the "new DM never arrives until you refresh" bug. The
 * structural events (`dm.created`) are single-shot and best-effort, and the
 * unread bump is a silent no-op for an unknown id, so without the heal below a
 * dropped event left the conversation invisible until a full page reload.
 */

// The socket, replaced with a handle the test can push events through.
const listeners = {
  event: new Set<(e: UserEvent) => void>(),
  status: new Set<(s: string, reconnected: boolean) => void>(),
};
vi.mock("@/lib/user-realtime", () => ({
  UserRealtime: class {
    onEvent(fn: (e: UserEvent) => void) {
      listeners.event.add(fn);
      return () => listeners.event.delete(fn);
    }
    onStatus(fn: (s: string, reconnected: boolean) => void) {
      listeners.status.add(fn);
      return () => listeners.status.delete(fn);
    }
    connect() {}
    close() {}
  },
}));

vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "u1" } } }) }));

vi.mock("react-router", () => ({
  useLocation: () => ({ pathname: "/dashboard/w1" }),
  useNavigate: () => vi.fn(),
}));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { info: vi.fn() }) }));

import { toast } from "sonner";
import { NotificationsProvider } from "./notifications-provider";
import { channelsKey } from "@/features/channels/api/keys";
import { dmsKey } from "@/features/channels/api/use-dms";
import { notificationsKey, notificationsSummaryKey } from "../api/keys";

const WS = "w1";

/** Unique ids per notification, so the provider's dedupe guard never swallows one. */
let notifSeq = 0;

function emit(event: UserEvent) {
  act(() => {
    for (const fn of listeners.event) fn(event);
  });
}

function bump(channelId: string): UserEvent {
  return {
    kind: "unread.bump",
    workspaceId: WS,
    channelId,
    channelType: "dm",
    updatedSeq: 1,
  };
}

/** Did that query get marked stale (i.e. will it refetch)? */
function invalidated(qc: QueryClient, key: readonly unknown[]): boolean {
  return qc.getQueryState(key)?.isInvalidated === true;
}

let qc: QueryClient;

function mount() {
  render(
    <QueryClientProvider client={qc}>
      <NotificationsProvider>
        <div />
      </NotificationsProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listeners.event.clear();
  listeners.status.clear();
  vi.mocked(toast).mockClear();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe("awareness events for an unknown conversation", () => {
  it("refetches the lists when a bump names a conversation we don't have", () => {
    qc.setQueryData(dmsKey(WS), [{ id: "known-dm", unread: 0 }]);
    qc.setQueryData(channelsKey(WS), [{ id: "known-channel", unread: 0 }]);
    mount();

    emit(bump("brand-new-dm"));

    expect(invalidated(qc, dmsKey(WS))).toBe(true);
    expect(invalidated(qc, channelsKey(WS))).toBe(true);
  });

  it("just bumps the badge when the conversation is already known", () => {
    qc.setQueryData(dmsKey(WS), [{ id: "known-dm", unread: 0 }]);
    mount();

    emit(bump("known-dm"));

    expect(qc.getQueryData<{ unread: number }[]>(dmsKey(WS))![0]!.unread).toBe(1);
    expect(invalidated(qc, dmsKey(WS))).toBe(false);
  });

  it("leaves a never-opened workspace alone (its lists fetch on mount anyway)", () => {
    mount();

    emit(bump("some-dm"));

    expect(qc.getQueryState(dmsKey(WS))).toBeUndefined();
    expect(qc.getQueryState(channelsKey(WS))).toBeUndefined();
  });

  it("heals from a notification too — its 'View' resolves against these lists", () => {
    qc.setQueryData(dmsKey(WS), []);
    mount();

    emit({
      kind: "notification.created",
      notification: {
        id: "n1",
        type: "dm",
        workspaceId: WS,
        channelId: "brand-new-dm",
        channelName: null,
        messageId: "m1",
        actorId: "u2",
        actorName: "Bob",
        actorImage: null,
        important: false,
        createdAt: "2020-01-01T00:00:00.000Z",
        seenAt: null,
        readAt: null,
      },
    });

    expect(invalidated(qc, dmsKey(WS))).toBe(true);
  });
});

describe("toasts for a busy conversation", () => {
  /** A `notification.created` event for `channelId`, sent by `actorName`. */
  const notif = (channelId: string, actorName: string, over = {}): UserEvent => ({
    kind: "notification.created",
    notification: {
      id: `n-${++notifSeq}`,
      type: "dm",
      workspaceId: WS,
      channelId,
      channelName: "Project X",
      messageId: `m-${notifSeq}`,
      actorId: `u-${actorName}`,
      actorName,
      actorImage: null,
      important: false,
      createdAt: "2020-01-01T00:00:00.000Z",
      seenAt: null,
      readAt: null,
      ...over,
    },
  });

  it("folds follow-ups into ONE toast instead of stacking a new one each time", () => {
    // An eight-person group trading twenty messages used to throw twenty pop-ups,
    // each shoving the last off screen. Sonner treats a repeated id as an update.
    qc.setQueryData(dmsKey(WS), [{ id: "busy", unread: 0 }]);
    mount();

    emit(notif("busy", "Alice"));
    emit(notif("busy", "Bob"));
    emit(notif("busy", "Alice"));

    const calls = vi.mocked(toast).mock.calls;
    expect(calls).toHaveLength(3);
    // Same toast id every time — three calls, one toast on screen.
    const ids = calls.map((c) => (c[1] as { id: string }).id);
    expect(new Set(ids).size).toBe(1);
  });

  it("counts up and names the senders as it goes", () => {
    qc.setQueryData(dmsKey(WS), [{ id: "busy", unread: 0 }]);
    mount();

    emit(notif("busy", "Alice"));
    emit(notif("busy", "Bob"));
    emit(notif("busy", "Carol"));

    const calls = vi.mocked(toast).mock.calls;
    // First is a plain single-message toast...
    expect(calls[0]![0]).toBe("Alice");
    // ...the last is titled by the conversation and carries the running total.
    expect(calls[2]![0]).toBe("Project X");
    expect((calls[2]![1] as { description: string }).description).toBe(
      "Alice, Bob & 1 other · 3 new",
    );
  });

  it("keeps separate conversations on separate toasts", () => {
    qc.setQueryData(dmsKey(WS), [
      { id: "one", unread: 0 },
      { id: "two", unread: 0 },
    ]);
    mount();

    emit(notif("one", "Alice"));
    emit(notif("two", "Bob"));

    const ids = vi.mocked(toast).mock.calls.map((c) => (c[1] as { id: string }).id);
    expect(new Set(ids).size).toBe(2);
  });

  it("never renders a # in front of a group's name", () => {
    qc.setQueryData(dmsKey(WS), [{ id: "busy", unread: 0 }]);
    mount();

    emit(notif("busy", "Alice"));

    const description = (vi.mocked(toast).mock.calls[0]![1] as { description: string }).description;
    expect(description).toBe("New message in Project X");
    expect(description).not.toContain("#");
  });
});

describe("losing access to a conversation", () => {
  it("re-reads the inbox and the badge, not just the lists", () => {
    // The server has just deleted my notifications for it; neither cache would
    // notice on its own (the summary is `staleTime: Infinity`), so the switcher
    // kept a count for a conversation I can no longer open.
    qc.setQueryData(dmsKey(WS), [{ id: "gone", unread: 3 }]);
    qc.setQueryData(notificationsKey, { pages: [[]], pageParams: [undefined] });
    qc.setQueryData(notificationsSummaryKey, { unseen: 3, workspaces: [] });
    mount();

    emit({ kind: "channel.removed", workspaceId: WS, channelId: "gone" });

    expect(invalidated(qc, notificationsKey)).toBe(true);
    expect(invalidated(qc, notificationsSummaryKey)).toBe(true);
    expect(invalidated(qc, dmsKey(WS))).toBe(true);
  });
});

describe("reconnect self-heal", () => {
  it("reconciles the conversation lists, not just the inbox", () => {
    qc.setQueryData(dmsKey(WS), [{ id: "known-dm", unread: 0 }]);
    qc.setQueryData(channelsKey(WS), [{ id: "known-channel", unread: 0 }]);
    mount();

    // Anything structural that happened while we were down was lost — NOTIFY
    // doesn't replay, so the lists have to be re-read from the server.
    act(() => {
      for (const fn of listeners.status) fn("open", true);
    });

    expect(invalidated(qc, dmsKey(WS))).toBe(true);
    expect(invalidated(qc, channelsKey(WS))).toBe(true);
  });

  it("does nothing on the FIRST connect (nothing was missed yet)", () => {
    qc.setQueryData(dmsKey(WS), [{ id: "known-dm", unread: 0 }]);
    mount();

    act(() => {
      for (const fn of listeners.status) fn("open", false);
    });

    expect(invalidated(qc, dmsKey(WS))).toBe(false);
  });
});
