import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotificationWire } from "@server/infrastructure/realtime/protocol";

// Mock the data hooks so the bell renders against controlled state (no network).
const markSeen = vi.fn();
const markRead = vi.fn();
const summary = { unseen: 2, workspaces: [] };
const sample: NotificationWire = {
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

vi.mock("../api/use-notifications", () => ({
  useNotificationsSummary: () => ({ data: summary }),
  useNotificationsList: () => ({ data: [sample], isPending: false }),
  useMarkSeen: () => ({ mutate: markSeen }),
  useMarkRead: () => ({ mutate: markRead }),
}));

import { NotificationBell } from "./NotificationBell";

function renderBell() {
  return render(
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>,
  );
}

afterEach(() => vi.clearAllMocks());

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
});
