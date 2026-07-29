import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  coercePreferences,
  type PreferencesContractsMatch,
} from "./schema";

/**
 * `coercePreferences` is the boundary between untrusted payloads (a server
 * response from a different build, a localStorage blob written by an older
 * client) and the rest of the app. Every case below is a real thing that
 * happens across a rolling deploy, and none of them may throw inside a render.
 */

describe("client ↔ server contract", () => {
  it("describes the same payload as the server DTO", () => {
    // Fails to COMPILE (bun run typecheck) if the shapes diverge — the runtime
    // assertion below is just there to make the failure visible in the suite.
    const contractsMatch: PreferencesContractsMatch = true;
    expect(contractsMatch).toBe(true);
  });
});

describe("coercePreferences", () => {
  it("fills in defaults for an empty payload", () => {
    expect(coercePreferences({})).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps valid fields", () => {
    expect(coercePreferences({ mode: "dark", theme: "aubergine" })).toEqual({
      ...DEFAULT_PREFERENCES,
      mode: "dark",
      theme: "aubergine",
    });
  });

  // The important one: a theme retired in a later release, or a value written
  // by a newer client, must not cost the user their other settings.
  it("drops only the invalid field, keeping its siblings", () => {
    expect(
      coercePreferences({
        mode: "dark",
        theme: "a-theme-we-removed",
        density: "compact",
      }),
    ).toEqual({
      ...DEFAULT_PREFERENCES,
      mode: "dark",
      theme: DEFAULT_PREFERENCES.theme,
      density: "compact",
    });
  });

  it("ignores unknown keys", () => {
    const result = coercePreferences({ mode: "dark", somethingNew: "value" });
    expect(result).toEqual({ ...DEFAULT_PREFERENCES, mode: "dark" });
    expect(result).not.toHaveProperty("somethingNew");
  });

  it.each([null, undefined, "string", 42, [], true])(
    "returns defaults for the non-object %p",
    (input) => {
      expect(coercePreferences(input)).toEqual(DEFAULT_PREFERENCES);
    },
  );

  it("never throws on malformed field types", () => {
    expect(() =>
      coercePreferences({ mode: 123, density: {}, theme: [], version: "x" }),
    ).not.toThrow();
    expect(
      coercePreferences({ mode: 123, density: {}, theme: [] }),
    ).toEqual(DEFAULT_PREFERENCES);
  });

  it("defaults to following the OS", () => {
    expect(DEFAULT_PREFERENCES.mode).toBe("system");
    expect(DEFAULT_PREFERENCES.theme).toBe("default");
  });
});
