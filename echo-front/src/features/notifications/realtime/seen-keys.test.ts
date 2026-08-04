import { describe, expect, it } from "vitest";
import { SeenKeys } from "./seen-keys";

describe("SeenKeys", () => {
  it("admits a key once and rejects repeats", () => {
    const seen = new SeenKeys();

    expect(seen.add("u:c1:5")).toBe(true);
    expect(seen.add("u:c1:5")).toBe(false);
    expect(seen.add("u:c1:5")).toBe(false);
  });

  it("treats distinct keys independently", () => {
    const seen = new SeenKeys();

    expect(seen.add("u:c1:5")).toBe(true);
    expect(seen.add("u:c1:6")).toBe(true);
    expect(seen.add("n:abc")).toBe(true);
  });

  it("stays bounded at its maximum", () => {
    const seen = new SeenKeys(10);

    for (let i = 0; i < 100; i += 1) seen.add(`k${i}`);

    expect(seen.size).toBeLessThanOrEqual(10);
  });

  it("evicts the oldest key, keeping the recent window intact", () => {
    // The regression: bounding memory with clear() dropped EVERY recent key at
    // once, so an event replayed immediately after an overflow read as new and
    // bumped an unread count a second time — a badge the user can never clear.
    const seen = new SeenKeys(4);

    seen.add("a"); // oldest
    seen.add("b");
    seen.add("c");
    seen.add("d");
    seen.add("e"); // overflows → evicts "a" only

    expect(seen.add("b")).toBe(false); // still remembered
    expect(seen.add("c")).toBe(false);
    expect(seen.add("d")).toBe(false);
    expect(seen.add("e")).toBe(false);
    expect(seen.add("a")).toBe(true); // the one genuinely forgotten
  });

  it("never forgets the most recent key across a long run", () => {
    const seen = new SeenKeys(50);

    for (let i = 0; i < 500; i += 1) {
      const key = `k${i}`;
      seen.add(key);
      // Whatever was just applied must not be re-appliable — that is exactly
      // the replay window a reconnect exercises.
      expect(seen.add(key)).toBe(false);
    }
  });
});
