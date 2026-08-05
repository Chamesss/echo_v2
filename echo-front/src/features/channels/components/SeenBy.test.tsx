import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelReadDTO } from "../api/use-reads";

// Controlled state for the data hooks (no network / providers needed).
let reads: ChannelReadDTO[] = [];
const directory: Record<string, { name: string; image: string | null }> = {
  alice: { name: "Alice", image: null },
  bob: { name: "Bob", image: null },
};

vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "me" } } }) }));
vi.mock("../api/use-reads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/use-reads")>()),
  useChannelReads: () => ({ data: reads }),
}));
vi.mock("@/features/members/api/use-directory", () => ({ useDirectory: () => ({ data: directory }) }));

import { SeenBy } from "./SeenBy";

const props = { workspaceId: "w1", channelId: "c1", lastSeq: 5, lastAuthorId: "me" };

afterEach(() => {
  reads = [];
});

describe("SeenBy", () => {
  it("renders nothing when no one else has caught up", () => {
    reads = [{ userId: "me", lastReadSeq: 9 }]; // only the viewer
    const { container } = render(<SeenBy {...props} compact={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists readers who reached the last message", () => {
    reads = [
      { userId: "alice", lastReadSeq: 5 },
      { userId: "bob", lastReadSeq: 6 },
      { userId: "me", lastReadSeq: 9 },
    ];
    render(<SeenBy {...props} compact={false} />);
    expect(screen.getByText(/Seen by/)).toHaveTextContent("Seen by Alice, Bob");
  });

  it("collapses to a plain 'Seen' when only one reader is possible", () => {
    // A 1:1 — naming the single other participant adds nothing.
    reads = [{ userId: "alice", lastReadSeq: 5 }];
    render(<SeenBy {...props} compact />);
    expect(screen.getByText("Seen")).toBeInTheDocument();
  });

  it("names readers in a group rather than collapsing them", () => {
    // The regression this component was silently failing: a group used to be
    // folded in with 1:1s, so five people catching up and one person catching
    // up both rendered an identical, uninformative "Seen".
    reads = [
      { userId: "alice", lastReadSeq: 7 },
      { userId: "bob", lastReadSeq: 7 },
      { userId: "me", lastReadSeq: 9 },
    ];
    render(<SeenBy {...props} compact={false} />);

    expect(screen.getByText(/Seen by/)).toHaveTextContent("Seen by Alice, Bob");
    expect(screen.queryByText("Seen")).not.toBeInTheDocument();
  });

  it("distinguishes one reader from several in a group", () => {
    reads = [{ userId: "alice", lastReadSeq: 7 }];
    const { rerender } = render(<SeenBy {...props} compact={false} />);
    expect(screen.getByText(/Seen by/)).toHaveTextContent("Seen by Alice");

    reads = [
      { userId: "alice", lastReadSeq: 7 },
      { userId: "bob", lastReadSeq: 7 },
    ];
    rerender(<SeenBy {...props} compact={false} lastSeq={5} />);
    expect(screen.getByText(/Seen by/)).toHaveTextContent("Seen by Alice, Bob");
  });
});
