import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelDTO } from "../api/use-channels";
import type { DirectMessageDTO } from "../api/use-dms";

/**
 * Which conversations offer a settings gear.
 *
 * This encodes the distinction the header used to miss. A single `isDm` flag
 * folded 1:1s and group conversations together, so a group — which can be
 * renamed and whose members can change — inherited the "nothing to configure"
 * treatment written for 1:1s. The gear never rendered, which in turn made it
 * impossible to see who was in a group, add anyone, or leave it.
 */

const channels: ChannelDTO[] = [];
const dms: DirectMessageDTO[] = [];

vi.mock("../api/use-channels", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/use-channels")>()),
  useChannels: () => ({ data: channels, isPending: false }),
  useJoinChannel: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../api/use-dms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/use-dms")>()),
  useDirectMessages: () => ({ data: dms, isPending: false }),
}));
vi.mock("@/features/workspaces/hooks/use-current-workspace", () => ({
  useCurrentWorkspace: () => ({ id: "w1", name: "WS", role: "member" }),
}));

// The message subtree owns its own data/realtime hooks and isn't under test.
vi.mock("./MessageList", () => ({ MessageList: () => <div /> }));
vi.mock("./MessageComposer", () => ({ MessageComposer: () => <div /> }));
vi.mock("./TypingIndicator", () => ({ TypingIndicator: () => <div /> }));
vi.mock("./ChannelSettingsDialog", () => ({
  ChannelSettingsDialog: () => <div data-testid="settings-dialog" />,
}));
vi.mock("../api/use-messages", () => ({
  useMessages: () => ({ data: [], isPending: false }),
  useMarkRead: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/features/notifications/api/use-notifications", () => ({
  useMarkRead: () => ({ mutate: vi.fn() }),
}));
vi.mock("../realtime/use-channel-stream", () => ({ useChannelStream: () => {} }));

import { ChannelView } from "./ChannelView";

const base = {
  id: "c1",
  topic: null,
  archived: false,
  createdBy: "me",
  lastSeq: 0,
  isMember: true,
  unread: 0,
  createdAt: new Date(0).toISOString(),
};

function asChannel(type: "public" | "private"): ChannelDTO {
  return { ...base, type, name: "general" };
}

function asConversation(type: "direct" | "group", people: number): DirectMessageDTO {
  return {
    ...base,
    type,
    name: "Alice, Bob",
    customName: null,
    participants: Array.from({ length: people }, (_, i) => ({
      userId: `u${i}`,
      name: `User ${i}`,
      image: null,
    })),
  };
}

const gear = () => screen.queryByRole("button", { name: /channel settings/i });

beforeEach(() => {
  channels.length = 0;
  dms.length = 0;
});

describe("ChannelView settings gear", () => {
  it("offers settings on a public channel", () => {
    channels.push(asChannel("public"));
    render(<ChannelView channelId="c1" />);
    expect(gear()).toBeInTheDocument();
  });

  it("offers settings on a private channel", () => {
    channels.push(asChannel("private"));
    render(<ChannelView channelId="c1" />);
    expect(gear()).toBeInTheDocument();
  });

  it("offers settings on a group conversation", () => {
    // The reported bug. A group can be renamed, its people can change, and it
    // can be left — all of which live behind this button.
    dms.push(asConversation("group", 3));
    render(<ChannelView channelId="c1" />);
    expect(gear()).toBeInTheDocument();
  });

  it("hides settings on a 1:1", () => {
    // Genuinely nothing to configure: no name, no topic, fixed membership.
    dms.push(asConversation("direct", 2));
    render(<ChannelView channelId="c1" />);
    expect(gear()).not.toBeInTheDocument();
  });

  it("hides settings from a non-member of a public channel", () => {
    channels.push({ ...asChannel("public"), isMember: false });
    render(<ChannelView channelId="c1" />);
    expect(gear()).not.toBeInTheDocument();
  });
});

describe("ChannelView header", () => {
  it("shows how many people are in a group", () => {
    dms.push(asConversation("group", 4));
    render(<ChannelView channelId="c1" />);
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("shows no count for a 1:1", () => {
    dms.push(asConversation("direct", 2));
    render(<ChannelView channelId="c1" />);
    expect(screen.queryByText("2")).not.toBeInTheDocument();
  });
});
