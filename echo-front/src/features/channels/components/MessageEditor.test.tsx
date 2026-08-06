import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: vi.fn() };
});
import { apiFetch } from "@/lib/api";
import { WorkspaceProvider } from "@/features/workspaces/context/workspace-context";
import { MessageEditor } from "./MessageEditor";
import type { EchoMessage } from "../realtime/message-cache";

const POLICY = {
  maxPerMessage: 10,
  categories: [
    { category: "image", mimeTypes: ["image/png"], maxBytes: 25 * 1024 * 1024, render: "image" },
    { category: "file", mimeTypes: "*", maxBytes: 50 * 1024 * 1024, render: "file" },
  ],
};

const workspace = { id: "w1", slug: "w", name: "W", role: "member" as const, isOwner: false };

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockResolvedValue(POLICY);
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <WorkspaceProvider workspace={workspace}>{ui}</WorkspaceProvider>
    </QueryClientProvider>,
  );
}

function msg(over: Partial<EchoMessage> = {}): EchoMessage {
  return {
    id: "m1",
    channelId: "c1",
    authorId: "u1",
    body: "hi",
    clientId: "cid",
    seq: 1,
    updatedSeq: 1,
    version: 1,
    deleted: false,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: null,
    attachments: [
      {
        id: "att1",
        filename: "keep.png",
        contentType: "image/png",
        size: 1024,
        category: "image",
        url: "https://e/keep.png",
      },
    ],
    ...over,
  };
}

describe("MessageEditor", () => {
  it("shows existing attachments and keeps them on save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    wrap(<MessageEditor message={msg()} onSave={onSave} onCancel={() => {}} />);

    expect(screen.getByAltText("keep.png")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ body: "hi", keepAttachmentIds: ["att1"], attachments: [] }),
    );
  });

  it("drops an existing attachment from the keep set when removed", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    wrap(<MessageEditor message={msg()} onSave={onSave} onCancel={() => {}} />);

    await user.click(screen.getByLabelText("Remove keep.png"));
    expect(screen.queryByAltText("keep.png")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ keepAttachmentIds: [] }));
  });

  it("can't save when the result would be empty (no text, no attachments)", async () => {
    const user = userEvent.setup();
    wrap(<MessageEditor message={msg({ body: "" })} onSave={vi.fn()} onCancel={() => {}} />);

    await user.click(screen.getByLabelText("Remove keep.png"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
