import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyPreferences, resolveMode } from "./apply";
import { PREFERENCES_STORAGE_KEY } from "./storage";
import { DEFAULT_PREFERENCES, type AppearancePreferences } from "./schema";

/**
 * The boot script in index.html duplicates this module's attribute contract by
 * necessity — it must run synchronously before first paint, and a module import
 * would defer it past that point (see the comment in index.html).
 *
 * These tests pin the duplication down: the last block actually EXECUTES the
 * inline script against a seeded localStorage and asserts it produces the same
 * <html> attributes `applyPreferences` would. If someone renames a data
 * attribute, changes the storage key, or adds a preference to one side only,
 * this fails.
 */

/** Points `window.matchMedia` at a fixed OS preference. */
function stubSystemDark(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: dark && query.includes("dark"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
}

function resetRoot() {
  const root = document.documentElement;
  root.className = "";
  delete root.dataset.theme;
  delete root.dataset.density;
  delete root.dataset.reducedMotion;
}

function snapshotRoot() {
  const root = document.documentElement;
  return {
    dark: root.classList.contains("dark"),
    theme: root.dataset.theme,
    density: root.dataset.density,
    reducedMotion: root.dataset.reducedMotion,
  };
}

beforeEach(() => {
  resetRoot();
  localStorage.clear();
  stubSystemDark(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveMode", () => {
  it("passes explicit modes through untouched", () => {
    stubSystemDark(true);
    expect(resolveMode("light")).toBe("light");
    expect(resolveMode("dark")).toBe("dark");
  });

  it("follows the OS when set to system", () => {
    stubSystemDark(true);
    expect(resolveMode("system")).toBe("dark");
    stubSystemDark(false);
    expect(resolveMode("system")).toBe("light");
  });
});

describe("applyPreferences", () => {
  it("writes every appearance axis to <html>", () => {
    applyPreferences({
      version: 1,
      mode: "dark",
      theme: "aubergine",
      density: "compact",
      reducedMotion: "always",
    });

    expect(snapshotRoot()).toEqual({
      dark: true,
      theme: "aubergine",
      density: "compact",
      reducedMotion: "always",
    });
  });

  it("removes the dark class when switching back to light", () => {
    applyPreferences({ ...DEFAULT_PREFERENCES, mode: "dark" });
    expect(document.documentElement).toHaveClass("dark");

    applyPreferences({ ...DEFAULT_PREFERENCES, mode: "light" });
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("resolves system mode against the OS preference", () => {
    stubSystemDark(true);
    applyPreferences({ ...DEFAULT_PREFERENCES, mode: "system" });
    expect(document.documentElement).toHaveClass("dark");
  });

  it("is idempotent", () => {
    const prefs: AppearancePreferences = {
      ...DEFAULT_PREFERENCES,
      theme: "hoth",
    };
    applyPreferences(prefs);
    const first = snapshotRoot();
    applyPreferences(prefs);
    expect(snapshotRoot()).toEqual(first);
  });

  it("keeps meta[theme-color] in step with the sidebar", () => {
    applyPreferences({ ...DEFAULT_PREFERENCES, theme: "aubergine" });
    expect(
      document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
    ).toBe("#3f0e40");

    applyPreferences({ ...DEFAULT_PREFERENCES, theme: "terminal" });
    expect(
      document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
    ).toBe("#0b0f0b");
  });

  it("creates only one theme-color tag across repeated calls", () => {
    applyPreferences({ ...DEFAULT_PREFERENCES, theme: "hoth" });
    applyPreferences({ ...DEFAULT_PREFERENCES, theme: "banana" });
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
  });
});

describe("index.html boot script", () => {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

  /** The inline (non-module) script that runs before first paint. */
  const bootScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

  function runBootScript() {
    // Executing the shipped script is the entire point of this test; anything
    // less wouldn't catch drift if the boot script changed.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(bootScript)();
  }

  it("is present and inline (a module would be deferred past first paint)", () => {
    expect(bootScript).not.toBe("");
    expect(html).toMatch(/<script>\s*\(function/);
    // Must sit in <head>, before the bundle, or it can't beat the first paint.
    expect(html.indexOf("<script>")).toBeLessThan(
      html.indexOf('<script type="module"'),
    );
  });

  it("reads the same storage key the app writes", () => {
    expect(bootScript).toContain(PREFERENCES_STORAGE_KEY);
  });

  it.each([
    { mode: "dark", theme: "aubergine", density: "compact", reducedMotion: "always" },
    { mode: "light", theme: "hoth", density: "comfortable", reducedMotion: "system" },
    { mode: "system", theme: "terminal", density: "compact", reducedMotion: "system" },
  ] as const)("matches applyPreferences for %j", (partial) => {
    const prefs: AppearancePreferences = { ...DEFAULT_PREFERENCES, ...partial };

    // What the running app produces.
    applyPreferences(prefs);
    const fromApp = snapshotRoot();

    // What the boot script produces from the cache alone.
    resetRoot();
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(prefs));
    runBootScript();

    expect(snapshotRoot()).toEqual(fromApp);
  });

  it("falls back to defaults when nothing is cached", () => {
    runBootScript();
    expect(snapshotRoot()).toEqual({
      dark: false,
      theme: DEFAULT_PREFERENCES.theme,
      density: DEFAULT_PREFERENCES.density,
      reducedMotion: DEFAULT_PREFERENCES.reducedMotion,
    });
  });

  it("survives a corrupt cache instead of throwing", () => {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, "{not json");
    expect(() => runBootScript()).not.toThrow();
  });

  it("honours the OS preference when the cache says system", () => {
    stubSystemDark(true);
    localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_PREFERENCES, mode: "system" }),
    );
    runBootScript();
    expect(document.documentElement).toHaveClass("dark");
  });
});
