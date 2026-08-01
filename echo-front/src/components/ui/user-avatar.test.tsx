import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UserAvatar, initials } from "./user-avatar";

/**
 * The presence dot is TRI-state, and the third state is the one that matters:
 * `undefined` renders nothing, so every call site that doesn't care — and every
 * avatar whose presence snapshot hasn't loaded yet — looks exactly as it did
 * before presence existed. A grey "offline" dot that flips green a moment later
 * would be worse than no dot.
 */
describe("UserAvatar presence dot", () => {
  it("renders no dot when `online` is omitted", () => {
    render(<UserAvatar name="Ada Lovelace" />);
    expect(screen.queryByTestId("presence-dot")).not.toBeInTheDocument();
  });

  it("renders an online dot for true and an offline dot for false", () => {
    const { rerender } = render(<UserAvatar name="Ada" online />);
    expect(screen.getByTestId("presence-dot")).toHaveAttribute("data-online", "true");
    expect(screen.getByTestId("presence-dot")).toHaveAttribute("title", "Online");

    rerender(<UserAvatar name="Ada" online={false} />);
    expect(screen.getByTestId("presence-dot")).toHaveAttribute("data-online", "false");
    expect(screen.getByTestId("presence-dot")).toHaveAttribute("title", "Offline");
  });

  it("keeps `className` on the positioning wrapper, not the clipping circle", () => {
    // Regression guard for the two-span split: the dot has to sit OUTSIDE the
    // `overflow-hidden` box or it gets clipped away, and callers' sizing must
    // still land on the outer element or every avatar in the app changes size.
    const { container } = render(<UserAvatar name="Ada" className="h-8 w-8" online />);
    const outer = container.firstElementChild!;

    expect(outer).toHaveClass("h-8", "w-8", "relative");
    expect(outer.className).not.toContain("overflow-hidden");
    expect(outer).toContainElement(screen.getByTestId("presence-dot"));
  });

  it("still falls back to initials", () => {
    render(<UserAvatar name="Ada Lovelace" online />);
    expect(screen.getByText("AL")).toBeInTheDocument();
  });
});

describe("initials", () => {
  it("takes leading letters and falls back to ?", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("Ada Lovelace", 1)).toBe("A");
    expect(initials("   ")).toBe("?");
  });
});
