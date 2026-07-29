import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// The editor owns the upload hooks (query client + workspace context); stub it so
// MessageRow stays presentational + testable in isolation. The real editor has
// its own test (MessageEditor.test).
vi.mock("./MessageEditor", () => ({
  MessageEditor: ({ onSave }: { onSave: (p: unknown) => void }) => (
    <button onClick={() => onSave({ body: "edited body", keepAttachmentIds: [], attachments: [] })}>
      Save
    </button>
  ),
}));

import { MessageRow } from "./MessageRow";
import type { EchoMessage } from "../realtime/message-cache";

function msg(over: Partial<EchoMessage> = {}): EchoMessage {
  return {
    id: "m1",
    channelId: "c",
    authorId: "u1",
    body: "hello world",
    clientId: "cid",
    seq: 1,
    updatedSeq: 1,
    version: 1,
    deleted: false,
    createdAt: "2020-01-01T10:00:00.000Z",
    updatedAt: null,
    ...over,
  };
}

const noop = () => {};

afterEach(() => vi.restoreAllMocks());

describe("MessageRow", () => {
  it("shows the resolved author name and body", () => {
    render(
      <MessageRow message={msg()} isOwn={false} authorName="Alice" authorImage={null} onEdit={noop} onDelete={noop} />,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("tags edited messages", () => {
    render(
      <MessageRow message={msg({ version: 2 })} isOwn authorName="You" authorImage={null} onEdit={noop} onDelete={noop} />,
    );
    expect(screen.getByText("(edited)")).toBeInTheDocument();
  });

  it("renders a tombstone for deleted messages", () => {
    render(
      <MessageRow message={msg({ deleted: true })} isOwn authorName="You" authorImage={null} onEdit={noop} onDelete={noop} />,
    );
    expect(screen.getByText("This message was deleted")).toBeInTheDocument();
    expect(screen.queryByText("hello world")).not.toBeInTheDocument();
  });

  it("renders a departed author's message as unavailable", () => {
    render(
      <MessageRow
        message={msg({ authorActive: false, body: "" })}
        isOwn={false}
        authorName="Former member"
        authorImage={null}
        onEdit={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText("Former member")).toBeInTheDocument();
    expect(screen.getByText("Message unavailable")).toBeInTheDocument();
  });

  it("offers no edit/delete controls on other people's messages", () => {
    render(
      <MessageRow message={msg()} isOwn={false} authorName="Alice" authorImage={null} onEdit={noop} onDelete={noop} />,
    );
    expect(screen.queryByLabelText("Edit message")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete message")).not.toBeInTheDocument();
  });

  it("opens the editor and forwards its save payload on own messages", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(
      <MessageRow message={msg()} isOwn authorName="You" authorImage={null} onEdit={onEdit} onDelete={noop} />,
    );

    await user.click(screen.getByLabelText("Edit message"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onEdit).toHaveBeenCalledWith(
      "m1",
      expect.objectContaining({ body: "edited body", keepAttachmentIds: [], attachments: [] }),
    );
  });

  it("deletes on confirm", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <MessageRow message={msg()} isOwn authorName="You" authorImage={null} onEdit={noop} onDelete={onDelete} />,
    );

    await user.click(screen.getByLabelText("Delete message"));
    expect(onDelete).toHaveBeenCalledWith("m1");
  });
});
