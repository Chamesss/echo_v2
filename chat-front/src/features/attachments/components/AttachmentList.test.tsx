import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AttachmentWire } from "@server/infrastructure/realtime/protocol";
import { AttachmentList } from "./AttachmentList";

const make = (over: Partial<AttachmentWire>): AttachmentWire => ({
  id: "a1",
  filename: "file",
  contentType: "application/octet-stream",
  size: 1024,
  category: "file",
  url: "https://example.test/x",
  ...over,
});

describe("AttachmentList", () => {
  it("renders an image inline", () => {
    render(
      <AttachmentList attachments={[make({ category: "image", filename: "p.png", url: "https://e/p.png" })]} />,
    );
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://e/p.png");
  });

  it("renders a video player", () => {
    const { container } = render(
      <AttachmentList attachments={[make({ category: "video", url: "https://e/v.mp4" })]} />,
    );
    const video = container.querySelector("video");
    expect(video).toHaveAttribute("src", "https://e/v.mp4");
  });

  it("renders a download chip (name + size + link) for non-media files", () => {
    render(
      <AttachmentList
        attachments={[make({ category: "file", filename: "data.bin", size: 2048, url: "https://e/d" })]}
      />,
    );
    expect(screen.getByText("data.bin")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://e/d");
  });

  it("renders nothing when there are no attachments", () => {
    const { container } = render(<AttachmentList attachments={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
