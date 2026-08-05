import { describe, expect, it } from "vitest";
import type { NotificationWire } from "@server/infrastructure/realtime/protocol";
import {
  describeCoalesced,
  describeNotification,
  participantLabel,
} from "@server/modules/notifications/notification-copy";

/**
 * The wording rules, in one place — which is the point of the module.
 *
 * These were previously written twice (the toast and the tray), and both copies
 * put a `#` in front of `channelName`. `#` means PUBLIC CHANNEL, so the moment
 * named groups started sending their name, a private group conversation began
 * announcing itself as "#Project X".
 */

const wire = (over: Partial<NotificationWire> = {}): NotificationWire => ({
  id: "n1",
  type: "dm",
  workspaceId: "w1",
  channelId: "c1",
  channelName: null,
  messageId: "m1",
  actorId: "u1",
  actorName: "Alice",
  actorImage: null,
  important: false,
  createdAt: new Date(0).toISOString(),
  seenAt: null,
  readAt: null,
  ...over,
});

describe("participantLabel", () => {
  it("lists everyone when uncapped", () => {
    // The sidebar's budget: a conversation row gets a whole line.
    expect(participantLabel(["Bob", "Carol", "Dave", "Erin"])).toBe("Bob, Carol, Dave, Erin");
  });

  it("collapses the tail past the cap", () => {
    expect(participantLabel(["Bob", "Carol", "Dave", "Erin"], 2)).toBe("Bob, Carol & 2 others");
  });

  it("says 'other' for exactly one extra", () => {
    expect(participantLabel(["Bob", "Carol", "Dave"], 2)).toBe("Bob, Carol & 1 other");
  });

  it("doesn't collapse when the cap isn't exceeded", () => {
    expect(participantLabel(["Bob", "Carol"], 2)).toBe("Bob, Carol");
  });

  it("handles nobody", () => {
    expect(participantLabel([], 2)).toBe("");
  });
});

describe("describeNotification", () => {
  it("keeps the # on a real channel", () => {
    const copy = describeNotification(wire({ type: "message", channelName: "general" }));
    expect(copy.title).toBe("Alice");
    expect(copy.body).toBe("posted in #general");
  });

  it("names a group WITHOUT a #", () => {
    // The reported bug. A group isn't a public channel, and the sigil claimed it was.
    const copy = describeNotification(wire({ type: "dm", channelName: "Project X" }));
    expect(copy.body).toBe("posted in Project X");
    expect(copy.body).not.toContain("#");
    expect(copy.toastBody).not.toContain("#");
  });

  it("names an unnamed group by its people", () => {
    // The server derives this per recipient; here it just has to render un-sigiled.
    const copy = describeNotification(wire({ type: "dm", channelName: "Bob, Carol & 2 others" }));
    expect(copy.body).toBe("posted in Bob, Carol & 2 others");
  });

  it("says nothing about location for a 1:1", () => {
    const copy = describeNotification(wire({ type: "dm", channelName: null }));
    expect(copy.body).toBe("sent you a message");
  });
});

describe("describeCoalesced", () => {
  it("is identical to a single notification at count 1", () => {
    const n = wire({ type: "message", channelName: "general" });
    expect(describeCoalesced(n, ["Alice"], 1)).toEqual(describeNotification(n));
  });

  it("leads with the conversation and counts once it's plural", () => {
    const n = wire({ type: "dm", channelName: "Project X" });
    const copy = describeCoalesced(n, ["Alice", "Bob", "Carol"], 6);
    expect(copy.title).toBe("Project X");
    expect(copy.toastBody).toBe("Alice, Bob & 1 other · 6 new");
  });

  it("falls back to the senders for an unnamed 1:1", () => {
    const copy = describeCoalesced(wire(), ["Alice"], 4);
    expect(copy.title).toBe("Alice");
    expect(copy.toastBody).toBe("4 new messages");
  });
});
