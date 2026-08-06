import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useEverResolved } from "./use-ever-resolved";

describe("useEverResolved", () => {
  it("stays false while pending has never resolved", () => {
    const { result } = renderHook(() => useEverResolved(true));
    expect(result.current).toBe(false);
  });

  it("latches true once pending goes false, and stays true when it returns", () => {
    const { result, rerender } = renderHook(({ p }) => useEverResolved(p), {
      initialProps: { p: true },
    });
    expect(result.current).toBe(false);

    rerender({ p: false });
    expect(result.current).toBe(true);

    // The behaviour the guards depend on: a background refetch flips `isPending`
    // back to true, and the latch must NOT reset or the spinner reappears.
    rerender({ p: true });
    expect(result.current).toBe(true);
  });

  it("is already latched when pending starts false", () => {
    const { result } = renderHook(() => useEverResolved(false));
    expect(result.current).toBe(true);
  });
});
