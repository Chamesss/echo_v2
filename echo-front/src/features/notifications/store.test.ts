import { describe, expect, it } from "vitest";
import type { NotificationWire } from "@server/infrastructure/realtime/protocol";
import type { NotificationSummary } from "@server/modules/notifications/notifications.service";
import {
  addNotificationToSummary,
  bumpChannelUnread,
  bumpWorkspaceUnread,
  prependNotification,
  sumUnread,
} from "./store";

function summary(over: Partial<NotificationSummary> = {}): NotificationSummary {
  return { unseen: 0, workspaces: [], ...over };
}

function notif(over: Partial<NotificationWire> = {}): NotificationWire {
  return {
    id: "n1",
    type: "dm",
    workspaceId: "w1",
    channelId: "c1",
    channelName: null,
    messageId: "m1",
    actorId: "u2",
    actorName: "Bob",
    actorImage: null,
    important: false,
    createdAt: "2020-01-01T00:00:00.000Z",
    seenAt: null,
    readAt: null,
    ...over,
  };
}

describe("notification store reducers", () => {
  it("bumps an existing workspace's unread and seeds an unknown one", () => {
    const s = summary({ workspaces: [{ workspaceId: "w1", unread: 2, notifications: 0 }] });
    expect(bumpWorkspaceUnread(s, "w1", 1).workspaces[0]).toMatchObject({ unread: 3 });
    // Unknown workspace gets seeded only for a positive delta.
    const seeded = bumpWorkspaceUnread(s, "w2", 1).workspaces.find((w) => w.workspaceId === "w2");
    expect(seeded).toMatchObject({ unread: 1, notifications: 0 });
    expect(bumpWorkspaceUnread(s, "w3", -1).workspaces.find((w) => w.workspaceId === "w3")).toBeUndefined();
  });

  it("never drives unread below zero", () => {
    const s = summary({ workspaces: [{ workspaceId: "w1", unread: 0, notifications: 0 }] });
    expect(bumpWorkspaceUnread(s, "w1", -5).workspaces[0]!.unread).toBe(0);
  });

  it("adds a notification: +1 unseen and +1 to the workspace's count", () => {
    const s = summary({ workspaces: [{ workspaceId: "w1", unread: 0, notifications: 1 }] });
    const next = addNotificationToSummary(s, "w1");
    expect(next.unseen).toBe(1);
    expect(next.workspaces[0]).toMatchObject({ notifications: 2 });
  });

  it("prepends a notification, deduping by id", () => {
    const a = notif({ id: "a" });
    const b = notif({ id: "b" });
    const list = prependNotification([a], b);
    expect(list.map((n) => n.id)).toEqual(["b", "a"]);
    // Re-adding an existing id moves it to the front without duplicating.
    expect(prependNotification(list, a).map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("bumps a single channel's unread and leaves others untouched", () => {
    const list = [
      { id: "c1", unread: 0 },
      { id: "c2", unread: 3 },
    ];
    const next = bumpChannelUnread(list, "c1")!;
    expect(next.find((c) => c.id === "c1")!.unread).toBe(1);
    expect(next.find((c) => c.id === "c2")!.unread).toBe(3);
    // An unknown channel returns the list reference unchanged.
    expect(bumpChannelUnread(list, "nope")).toBe(list);
  });

  it("sums unread across channel + DM lists", () => {
    expect(sumUnread([[{ unread: 2 }, { unread: 1 }], [{ unread: 4 }], undefined])).toBe(7);
  });

  it("excludes the actively-viewed conversation from the sum", () => {
    expect(
      sumUnread([[{ id: "a", unread: 2 }, { id: "b", unread: 1 }], [{ id: "c", unread: 4 }]], "b"),
    ).toBe(6);
  });
});
