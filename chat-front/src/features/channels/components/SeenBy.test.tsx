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
    const { container } = render(<SeenBy {...props} isDm={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists channel readers who reached the last message", () => {
    reads = [
      { userId: "alice", lastReadSeq: 5 },
      { userId: "bob", lastReadSeq: 6 },
      { userId: "me", lastReadSeq: 9 },
    ];
    render(<SeenBy {...props} isDm={false} />);
    expect(screen.getByText(/Seen by/)).toHaveTextContent("Seen by Alice, Bob");
  });

  it("shows a plain 'Seen' for a DM", () => {
    reads = [{ userId: "alice", lastReadSeq: 5 }];
    render(<SeenBy {...props} isDm />);
    expect(screen.getByText("Seen")).toBeInTheDocument();
  });
});
