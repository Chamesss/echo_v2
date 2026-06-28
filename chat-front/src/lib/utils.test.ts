import { describe, expect, it } from "vitest";
import { bustCache, cn } from "@/lib/utils";

/**
 * Smoke test that proves the frontend Vitest runner works end to end: the `@`
 * alias resolves, TS compiles under the React/Vite plugin pipeline, and the
 * jsdom environment boots. Real component tests (React Testing Library) arrive
 * in Sprint 5.
 */
describe("cn", () => {
  it("merges class names and resolves Tailwind conflicts", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm", false && "hidden", "font-bold")).toBe("text-sm font-bold");
  });
});

describe("bustCache", () => {
  it("returns an empty string for a null source", () => {
    expect(bustCache(null)).toBe("");
  });

  it("appends a timestamp param, choosing ? or & correctly", () => {
    expect(bustCache("/a.png")).toMatch(/^\/a\.png\?timestamp=\d+$/);
    expect(bustCache("/a.png?v=1")).toMatch(/^\/a\.png\?v=1&timestamp=\d+$/);
  });
});
