import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The compatibility rules that let old and new clients hit the same server
 * during a rolling deploy without corrupting each other's preferences:
 *
 *   READ is lenient  — a malformed or partly-unrecognised row must degrade to
 *                      defaults per field, never throw.
 *   WRITE is a merge — a partial patch must not blank out the fields it omits.
 *
 * `controlDb` is stubbed so this stays a unit test (no Postgres) — the logic
 * under test is the coercion and merge, not the SQL.
 */

/** Rows the stubbed select() will return. Set per test. */
let selectRows: Array<{ preferences: unknown }> = [];
/** Captures what the service tried to persist. */
let inserted: { userId: string; preferences: unknown } | null = null;

vi.mock("../../src/infrastructure/database/control/client.js", () => ({
  controlDb: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectRows,
        }),
      }),
    }),
    insert: () => ({
      values: (row: { userId: string; preferences: unknown }) => {
        inserted = row;
        return { onConflictDoUpdate: async () => undefined };
      },
    }),
  },
}));

const { getPreferences, updatePreferences } = await import(
  "../../src/modules/preferences/preferences.service.js"
);
const { DEFAULT_PREFERENCES, updatePreferencesBody, themeId } = await import(
  "../../src/modules/preferences/preferences.dto.js"
);

beforeEach(() => {
  selectRows = [];
  inserted = null;
});

describe("getPreferences", () => {
  it("returns defaults when the user has no row", async () => {
    expect(await getPreferences("u1")).toEqual(DEFAULT_PREFERENCES);
  });

  it("returns defaults for an empty payload", async () => {
    selectRows = [{ preferences: {} }];
    expect(await getPreferences("u1")).toEqual(DEFAULT_PREFERENCES);
  });

  it("merges a stored payload over the defaults", async () => {
    selectRows = [{ preferences: { mode: "dark", theme: "aubergine" } }];
    expect(await getPreferences("u1")).toEqual({
      ...DEFAULT_PREFERENCES,
      mode: "dark",
      theme: "aubergine",
    });
  });

  // The key resilience case: a theme retired in a later release must not cost
  // the user every other preference they set.
  it("discards only the invalid field, keeping its siblings", async () => {
    selectRows = [
      {
        preferences: {
          mode: "dark",
          theme: "a-theme-we-removed",
          density: "compact",
        },
      },
    ];
    expect(await getPreferences("u1")).toEqual({
      ...DEFAULT_PREFERENCES,
      mode: "dark",
      theme: DEFAULT_PREFERENCES.theme,
      density: "compact",
    });
  });

  it("ignores keys it doesn't recognise", async () => {
    selectRows = [{ preferences: { mode: "dark", futureSetting: "x" } }];
    const result = await getPreferences("u1");
    expect(result).toEqual({ ...DEFAULT_PREFERENCES, mode: "dark" });
    expect(result).not.toHaveProperty("futureSetting");
  });

  it.each([null, undefined, "string", 42, [], true])(
    "falls back to defaults for the corrupt payload %p",
    async (payload) => {
      selectRows = [{ preferences: payload }];
      await expect(getPreferences("u1")).resolves.toEqual(DEFAULT_PREFERENCES);
    },
  );
});

describe("updatePreferences", () => {
  it("applies a patch on top of the stored value", async () => {
    selectRows = [{ preferences: { mode: "dark", density: "compact" } }];

    const result = await updatePreferences("u1", { theme: "ochre" });

    expect(result).toEqual({
      ...DEFAULT_PREFERENCES,
      mode: "dark",
      density: "compact",
      theme: "ochre",
    });
  });

  // An older client that only knows about `mode` must not wipe `density`.
  it("preserves fields the patch omits", async () => {
    selectRows = [
      { preferences: { mode: "dark", density: "compact", theme: "hoth" } },
    ];

    const result = await updatePreferences("u1", { mode: "light" });

    expect(result.density).toBe("compact");
    expect(result.theme).toBe("hoth");
    expect(result.mode).toBe("light");
  });

  it("persists the full merged payload, not just the patch", async () => {
    selectRows = [{ preferences: { mode: "dark" } }];

    await updatePreferences("u1", { theme: "banana" });

    expect(inserted).toEqual({
      userId: "u1",
      preferences: {
        ...DEFAULT_PREFERENCES,
        mode: "dark",
        theme: "banana",
      },
    });
  });

  it("works for a user with no existing row", async () => {
    const result = await updatePreferences("u1", { mode: "dark" });
    expect(result).toEqual({ ...DEFAULT_PREFERENCES, mode: "dark" });
  });
});

describe("updatePreferencesBody validation", () => {
  it("accepts a single-field patch", () => {
    expect(updatePreferencesBody.parse({ mode: "dark" })).toEqual({ mode: "dark" });
  });

  it("strips unknown keys instead of persisting them", () => {
    expect(updatePreferencesBody.parse({ mode: "dark", evil: "<script>" })).toEqual({
      mode: "dark",
    });
  });

  it("rejects an empty patch", () => {
    expect(() => updatePreferencesBody.parse({})).toThrow();
  });

  it.each([
    { theme: "not-a-theme" },
    { mode: "neon" },
    { density: "microscopic" },
  ])("rejects the invalid patch %j", (patch) => {
    expect(() => updatePreferencesBody.parse(patch)).toThrow();
  });

  // Themes are a closed set precisely so user input never reaches a CSS context.
  it("only allows curated theme ids", () => {
    expect(() => themeId.parse("#3f0e40")).toThrow();
    expect(() => themeId.parse("aubergine")).not.toThrow();
  });
});
