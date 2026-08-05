import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotificationWire } from "@server/infrastructure/realtime/protocol";

// Mock the data hooks so the bell renders against controlled state (no network).
const markSeen = vi.fn();
const markRead = vi.fn();
const summary = { unseen: 2, workspaces: [] };

const baseNotification: NotificationWire = {
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
  createdAt: new Date().toISOString(),
  seenAt: null,
  readAt: null,
};

/** Swapped per test so one bell can be shown a channel, a group or a 1:1. */
let sample: NotificationWire = baseNotification;

/** Paging state the tray renders against; swapped per test. */
const paging = { hasNextPage: false, isFetchingNextPage: false };
const fetchNextPage = vi.fn();

vi.mock("../api/use-notifications", () => ({
  useNotificationsSummary: () => ({ data: summary }),
  useNotificationsList: () => ({
    data: { pages: [[sample]], pageParams: [undefined] },
    isPending: false,
    fetchNextPage,
    ...paging,
  }),
  useMarkSeen: () => ({ mutate: markSeen }),
  useMarkRead: () => ({ mutate: markRead }),
}));

// Presence too: each row resolves its own, keyed by the notification's
// workspace (the bell is app-wide, so there's no single workspace to read from).
vi.mock("@/features/members/api/use-presence", () => ({
  usePresence: () => ({ data: new Set(["u2"]) }),
}));

import { NotificationBell } from "./NotificationBell";

function renderBell() {
  return render(
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  sample = baseNotification;
  paging.hasNextPage = false;
  paging.isFetchingNextPage = false;
});

/**
 * Open the tray on a fresh bell and return its single row's text.
 *
 * Tears down any previous render first, so one test can contrast two
 * notification shapes without two bells fighting over the same label.
 */
async function locationLine(n: NotificationWire): Promise<string> {
  cleanup();
  sample = n;
  const user = userEvent.setup();
  renderBell();
  await user.click(screen.getByLabelText("Notifications"));
  return screen.getByRole("menuitem").textContent ?? "";
}

describe("NotificationBell", () => {
  it("shows the unseen count badge", () => {
    renderBell();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("marks everything seen and lists notifications when opened", async () => {
    const user = userEvent.setup();
    renderBell();

    await user.click(screen.getByLabelText("Notifications"));

    expect(markSeen).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("sent you a message")).toBeInTheDocument();
  });

  it("marks an item read when clicked", async () => {
    const user = userEvent.setup();
    renderBell();

    await user.click(screen.getByLabelText("Notifications"));
    await user.click(screen.getByText("Bob"));

    expect(markRead).toHaveBeenCalledWith({ ids: ["n1"] });
  });

  it("keeps the # on a channel but never puts one on a group", async () => {
    // `#` is the public-channel sigil. Both renderers used to hardcode it, so a
    // private group conversation announced itself as "#Project X" the moment
    // named groups started sending their name.
    expect(
      await locationLine({ ...baseNotification, type: "message", channelName: "general" }),
    ).toContain("posted in #general");

    expect(
      await locationLine({ ...baseNotification, type: "dm", channelName: "Project X" }),
    ).toContain("posted in Project X");
  });

  it("names an unnamed group by its people rather than reading like a 1:1", async () => {
    const line = await locationLine({
      ...baseNotification,
      type: "dm",
      channelName: "Alice, Carol & 2 others",
    });
    expect(line).toContain("posted in Alice, Carol & 2 others");
    expect(line).not.toContain("sent you a message");
  });

  it("offers 'Show older' only when the server has more", async () => {
    const user = userEvent.setup();
    renderBell();
    await user.click(screen.getByLabelText("Notifications"));
    // Exhausted list: no dead control.
    expect(screen.queryByRole("button", { name: /show older/i })).not.toBeInTheDocument();

    cleanup();
    paging.hasNextPage = true;
    renderBell();
    await user.click(screen.getByLabelText("Notifications"));
    await user.click(screen.getByRole("button", { name: /show older/i }));

    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("shows the actor's presence on their avatar", async () => {
    const user = userEvent.setup();
    renderBell();

    await user.click(screen.getByLabelText("Notifications"));

    // "u2" is online per the mock above, and the row asks for presence in the
    // notification's OWN workspace — not whichever one happens to be open.
    expect(screen.getByTestId("presence-dot")).toHaveAttribute("data-online", "true");
  });
});
