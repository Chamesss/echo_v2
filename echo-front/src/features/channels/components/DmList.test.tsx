import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectMessageDTO } from "../api/use-dms";

/**
 * How the sidebar draws a conversation.
 *
 * A 1:1 collapses to one face with a presence dot. A group can't — several dots
 * would stack under each other's avatars — but it used to fall all the way back
 * to a generic grey glyph with no indication of who was in it or how many.
 *
 * The session race is the subtler half: "the others" is everyone except you, so
 * before the session resolves `undefined` matches nobody and YOU are counted as
 * a participant. A 1:1 then briefly has two "others" and renders as a group.
 */

const dms: DirectMessageDTO[] = [];
const session = { current: { user: { id: "me" } } as { user: { id: string } } | null };

vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: session.current }) }));
vi.mock("@/features/workspaces/hooks/use-current-workspace", () => ({
  useCurrentWorkspace: () => ({ id: "w1", name: "WS", role: "member" }),
}));
vi.mock("@/features/members/api/use-presence", () => ({
  usePresence: () => ({ data: new Set(["alice"]) }),
}));
vi.mock("../api/use-dms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/use-dms")>()),
  useDirectMessages: () => ({ data: dms, isPending: false }),
}));
vi.mock("./NewDmDialog", () => ({ NewDmDialog: () => <div /> }));

import { DmList } from "./DmList";

function conversation(
  type: "direct" | "group",
  others: string[],
  overrides: Partial<DirectMessageDTO> = {},
): DirectMessageDTO {
  return {
    id: `c-${type}-${others.join("-")}`,
    type,
    name: others.join(", "),
    customName: null,
    topic: null,
    archived: false,
    createdBy: "me",
    lastSeq: 0,
    isMember: true,
    unread: 0,
    createdAt: new Date(0).toISOString(),
    participants: [
      { userId: "me", name: "Me", image: null },
      ...others.map((n) => ({ userId: n.toLowerCase(), name: n, image: null })),
    ],
    ...overrides,
  };
}

const renderList = () =>
  render(
    <MemoryRouter>
      <DmList />
    </MemoryRouter>,
  );

beforeEach(() => {
  dms.length = 0;
  session.current = { user: { id: "me" } };
});

/**
 * `UserAvatar` renders a single initial (maxInitials={1}) rather than the full
 * name, so an avatar is identified by its letter. An exact text match won't
 * collide with the conversation label ("Alice, Bob"), which is a longer string.
 */
const avatars = () => ["A", "B", "C", "D", "E"].filter((i) => screen.queryByText(i) !== null);

describe("DmList", () => {
  it("shows one avatar, with presence, for a 1:1", () => {
    dms.push(conversation("direct", ["Alice"]));
    renderList();

    expect(avatars()).toEqual(["A"]);
    expect(screen.getByTestId("presence-dot")).toBeInTheDocument();
  });

  it("shows a face for each person in a group, not a generic glyph", () => {
    dms.push(conversation("group", ["Alice", "Bob"]));
    renderList();

    expect(avatars()).toEqual(["A", "B"]);
  });

  it("shows how many people are in a group", () => {
    dms.push(conversation("group", ["Alice", "Bob", "Carol"]));
    renderList();
    // Four participants including the viewer.
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("caps the avatar stack at three but keeps the count honest", () => {
    dms.push(conversation("group", ["Alice", "Bob", "Carol", "Dave", "Erin"]));
    renderList();

    expect(avatars()).toEqual(["A", "B", "C"]);
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  it("shows no presence dots on a group", () => {
    // Several dots would sit under each other's overlapping avatars.
    dms.push(conversation("group", ["Alice", "Bob"]));
    renderList();
    expect(screen.queryByTestId("presence-dot")).not.toBeInTheDocument();
  });

  it("does not mistake a 1:1 for a group before the session resolves", () => {
    // Without the guard, `p.userId !== undefined` keeps everyone — including
    // the viewer — so a two-person conversation briefly looks like a group.
    session.current = null;
    dms.push(conversation("direct", ["Alice"]));
    renderList();

    expect(screen.queryByText("2")).not.toBeInTheDocument();
    expect(avatars()).toEqual([]);
  });

  it("still labels the conversation", () => {
    dms.push(conversation("group", ["Alice", "Bob"]));
    renderList();
    expect(screen.getByText("Alice, Bob")).toBeInTheDocument();
  });
});
