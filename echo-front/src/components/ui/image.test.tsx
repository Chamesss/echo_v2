import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Image } from "./image";
import { UserAvatar } from "./user-avatar";

describe("Image", () => {
  it("lazy-loads and decodes asynchronously by default", () => {
    render(<Image src="/a.png" alt="a" />);
    const img = screen.getByAltText("a");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
  });

  it("loads eagerly when marked priority", () => {
    render(<Image src="/a.png" alt="a" priority />);
    expect(screen.getByAltText("a")).toHaveAttribute("loading", "eager");
  });

  it("renders the fallback instead of an empty src", () => {
    render(<Image src={null} alt="a" fallback={<span>AB</span>} />);
    expect(screen.getByText("AB")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("swaps to the fallback when the image fails to load", () => {
    render(<Image src="/gone.png" alt="a" fallback={<span>AB</span>} />);
    fireEvent.error(screen.getByAltText("a"));
    expect(screen.getByText("AB")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("retries when the src changes after a failure", () => {
    const { rerender } = render(<Image src="/gone.png" alt="a" fallback={<span>AB</span>} />);
    fireEvent.error(screen.getByAltText("a"));
    expect(screen.getByText("AB")).toBeInTheDocument();

    // A newly uploaded picture must not inherit the old URL's failure.
    rerender(<Image src="/new.png" alt="a" fallback={<span>AB</span>} />);
    expect(screen.getByAltText("a")).toHaveAttribute("src", "/new.png");
  });

  it("keeps rendering the same element across re-renders with a stable src", () => {
    // The flicker this component replaced came from re-mounting the <img> (or
    // changing its src) on every render, so the browser re-fetched each time.
    const { rerender } = render(<Image src="/a.png" alt="a" />);
    const first = screen.getByAltText("a");
    rerender(<Image src="/a.png" alt="a" />);
    expect(screen.getByAltText("a")).toBe(first);
  });
});

describe("UserAvatar", () => {
  it("shows initials when there is no picture", () => {
    render(<UserAvatar name="Ada Lovelace" />);
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("honours maxInitials for the tiny sizes", () => {
    render(<UserAvatar name="Ada Lovelace" maxInitials={1} />);
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("falls back to initials when the picture fails", () => {
    render(<UserAvatar name="Ada Lovelace" image="/gone.png" />);
    fireEvent.error(screen.getByRole("presentation", { hidden: true }));
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("renders a placeholder for a nameless user rather than nothing", () => {
    render(<UserAvatar name="   " />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });
});
