import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Starting a group conversation.
 *
 * Multi-select was already implemented and completely unadvertised — the dialog
 * said "New message", offered bare checkboxes, and nothing anywhere hinted that
 * picking two people produced a group. It also had no client-side cap, so going
 * past the server's limit failed with a raw error toast after the round-trip.
 */

const roster = [
  { userId: "me", name: "Me", email: "me@x.test", role: "member", isOwner: false, image: null },
  ...Array.from({ length: 12 }, (_, i) => ({
    userId: `u${i}`,
    name: `User ${i}`,
    email: `u${i}@x.test`,
    role: "member" as const,
    isOwner: false,
    image: null,
  })),
];

const openDm = { mutate: vi.fn(), isPending: false };

vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "me" } } }) }));
vi.mock("@/features/workspaces/hooks/use-current-workspace", () => ({
  useCurrentWorkspace: () => ({ id: "w1", name: "WS", role: "member" }),
}));
vi.mock("@/features/members/api/use-members", () => ({ useMembers: () => ({ data: roster }) }));
vi.mock("../api/use-dms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/use-dms")>()),
  useOpenDm: () => openDm,
}));

import { NewDmDialog } from "./NewDmDialog";

const boxes = () => screen.getAllByRole("checkbox") as HTMLInputElement[];

const renderDialog = () =>
  render(
    <MemoryRouter>
      <NewDmDialog onClose={vi.fn()} />
    </MemoryRouter>,
  );

beforeEach(() => {
  openDm.mutate.mockClear();
});

describe("NewDmDialog", () => {
  it("says that picking several people starts a group", () => {
    renderDialog();
    expect(screen.getByText(/several to start a group/i)).toBeInTheDocument();
  });

  it("excludes the viewer from the list", () => {
    renderDialog();
    expect(screen.queryByText("Me")).not.toBeInTheDocument();
    expect(boxes()).toHaveLength(12);
  });

  it("sends one id for a 1:1", () => {
    renderDialog();
    fireEvent.click(boxes()[0]!);
    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    expect(openDm.mutate).toHaveBeenCalledWith(["u0"], expect.anything());
  });

  it("sends every selected id for a group", () => {
    renderDialog();
    fireEvent.click(boxes()[0]!);
    fireEvent.click(boxes()[1]!);
    fireEvent.click(boxes()[2]!);
    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    expect(openDm.mutate).toHaveBeenCalledWith(["u0", "u1", "u2"], expect.anything());
  });

  it("retitles itself once it's a group", () => {
    renderDialog();
    expect(screen.getByText("New message")).toBeInTheDocument();

    fireEvent.click(boxes()[0]!);
    fireEvent.click(boxes()[1]!);

    expect(screen.getByText("New group conversation")).toBeInTheDocument();
  });

  it("stops at the server's cap instead of failing after the round-trip", () => {
    renderDialog();
    // `openDmBody` allows at most 9 OTHER participants.
    for (let i = 0; i < 12; i += 1) fireEvent.click(boxes()[i]!);

    const checked = boxes().filter((b) => b.checked);
    expect(checked).toHaveLength(9);
    expect(screen.getByText(/9 selected \(max\)/i)).toBeInTheDocument();
    // The ones that didn't fit are disabled rather than silently ignored.
    expect(boxes().filter((b) => b.disabled).length).toBeGreaterThan(0);
  });

  it("lets you deselect after hitting the cap", () => {
    renderDialog();
    for (let i = 0; i < 12; i += 1) fireEvent.click(boxes()[i]!);
    fireEvent.click(boxes()[0]!); // uncheck

    expect(boxes().filter((b) => b.checked)).toHaveLength(8);
    expect(boxes().every((b) => !b.disabled)).toBe(true);
  });

  it("can't be submitted with nobody picked", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: /start/i })).toBeDisabled();
  });
});
