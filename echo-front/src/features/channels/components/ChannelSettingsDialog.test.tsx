import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelDTO } from "../api/use-channels";
import type { DirectMessageDTO } from "../api/use-dms";

/**
 * What the settings dialog offers, per conversation type.
 *
 * Two rules are encoded here. First, a group is managed by its MEMBERS, not by
 * a workspace role — a channel is an organisational object an admin owns
 * whether or not they joined, a conversation is not. Second, a group has no
 * danger zone: deleting is blocked server-side, and archiving would hide it
 * from everyone with no way back, so leaving is the exit.
 */

const workspaceRole = { current: "member" as "admin" | "member" };
const session = { current: "me" };

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: session.current } } }),
}));
vi.mock("@/features/workspaces/hooks/use-current-workspace", () => ({
  useCurrentWorkspace: () => ({ id: "w1", name: "WS", role: workspaceRole.current }),
}));
vi.mock("@/features/members/api/use-members", () => ({
  useMembers: () => ({ data: [{ userId: "u9", name: "Zoe", email: "z@x.test" }] }),
}));
vi.mock("../api/use-channel-admin", () => ({
  useChannelMembers: () => ({
    data: [
      { userId: "me", name: "Me", email: "me@x.test" },
      { userId: "u1", name: "Alice", email: "a@x.test" },
    ],
  }),
  useAddChannelMember: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveChannelMember: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateChannel: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteChannel: () => ({ mutate: vi.fn(), isPending: false }),
  useLeaveChannel: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ChannelSettingsDialog } from "./ChannelSettingsDialog";

const base = {
  id: "c1",
  topic: null,
  archived: false,
  lastSeq: 0,
  isMember: true,
  unread: 0,
  createdAt: new Date(0).toISOString(),
};

const channel = (type: "public" | "private", createdBy = "me"): ChannelDTO => ({
  ...base,
  type,
  name: "general",
  createdBy,
});

const group = (createdBy = "me", customName: string | null = null): DirectMessageDTO => ({
  ...base,
  type: "group",
  name: customName ?? "Alice, Bob",
  customName,
  createdBy,
  participants: [
    { userId: "me", name: "Me", image: null },
    { userId: "u1", name: "Alice", image: null },
    { userId: "u2", name: "Bob", image: null },
  ],
});

const show = (c: ChannelDTO | DirectMessageDTO) =>
  render(
    <MemoryRouter>
      <ChannelSettingsDialog channel={c} onClose={vi.fn()} />
    </MemoryRouter>,
  );

beforeEach(() => {
  workspaceRole.current = "member";
  session.current = "me";
});

describe("ChannelSettingsDialog — groups", () => {
  it("calls itself a conversation", () => {
    show(group());
    expect(screen.getByText("Conversation settings")).toBeInTheDocument();
  });

  it("offers no danger zone", () => {
    show(group());
    expect(screen.queryByText(/danger zone/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /archive/i })).not.toBeInTheDocument();
  });

  it("lets a member leave", () => {
    show(group());
    expect(screen.getByRole("button", { name: /leave conversation/i })).toBeInTheDocument();
  });

  it("lists the people in it and lets a member add someone", () => {
    show(group());
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /add someone to this conversation/i }),
    ).toBeInTheDocument();
  });

  it("lets the creator remove someone else", () => {
    show(group("me"));
    expect(screen.getByRole("button", { name: /remove alice/i })).toBeInTheDocument();
  });

  it("hides remove from a non-creator member", () => {
    // No per-channel roles exist, so `created_by` is a group's only authority —
    // otherwise any member could clear the room.
    show(group("someone-else"));
    expect(screen.queryByRole("button", { name: /remove alice/i })).not.toBeInTheDocument();
    // ...but they can still add people and leave.
    expect(
      screen.getByRole("combobox", { name: /add someone to this conversation/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /leave conversation/i })).toBeInTheDocument();
  });

  it("gives a workspace admin no special power over it", () => {
    workspaceRole.current = "admin";
    session.current = "outsider";
    show({ ...group("someone-else"), isMember: false });

    expect(screen.queryByText(/danger zone/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove alice/i })).not.toBeInTheDocument();
  });

  it("edits the stored name, not the derived label", () => {
    // A group with no name of its own displays "Alice, Bob". Prefilling the form
    // with that would turn today's participant list into a permanent title the
    // moment anyone pressed Save.
    show(group("me", null));
    const nameInput = screen.getAllByRole("textbox")[0] as HTMLInputElement;
    expect(nameInput.value).toBe("");
  });

  it("prefills a name the group actually has", () => {
    show(group("me", "Project X"));
    const nameInput = screen.getAllByRole("textbox")[0] as HTMLInputElement;
    expect(nameInput.value).toBe("Project X");
  });
});

describe("ChannelSettingsDialog — channels", () => {
  it("keeps its danger zone for the creator", () => {
    show(channel("public", "me"));
    expect(screen.getByText(/danger zone/i)).toBeInTheDocument();
  });

  it("gives a workspace admin full control even without joining", () => {
    workspaceRole.current = "admin";
    session.current = "outsider";
    show(channel("public", "someone-else"));

    expect(screen.getByText(/danger zone/i)).toBeInTheDocument();
  });

  it("shows members only on a private channel", () => {
    show(channel("public", "me"));
    expect(screen.queryByRole("combobox", { name: /add a member/i })).not.toBeInTheDocument();

    show(channel("private", "me"));
    expect(screen.getByRole("combobox", { name: /add a member/i })).toBeInTheDocument();
  });
});
