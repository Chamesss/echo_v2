import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Provider behaviour that production depends on:
 *   - signed-out routes must NOT hit /api/preferences (they'd 401-loop)
 *   - the server row must win over the local cache
 *   - `system` mode must react to the OS live
 *   - sign-out must not leak a theme to the next user of the browser
 */

// Controlled session + API so the provider runs against known state.
const sessionState: { data: { user: { id: string } } | null; isPending: boolean } = {
  data: { user: { id: "u1" } },
  isPending: false,
};
vi.mock("@/lib/auth-client", () => ({
  useSession: () => sessionState,
}));

const apiFetch = vi.fn();
vi.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

import { AppearanceProvider, useAppearance } from "./appearance-provider";
import { PREFERENCES_STORAGE_KEY, clearCachedPreferences } from "./storage";
import { DEFAULT_PREFERENCES } from "./schema";

/** Lets a test drive `prefers-color-scheme` and fire a change event. */
let systemDark = false;
const listeners = new Set<(e: MediaQueryListEvent) => void>();

function installMatchMedia() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return systemDark && query.includes("dark");
      },
      media: query,
      addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) =>
        listeners.add(cb),
      removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) =>
        listeners.delete(cb),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
}

function setSystemDark(dark: boolean) {
  systemDark = dark;
  act(() => {
    for (const cb of listeners) cb({ matches: dark } as MediaQueryListEvent);
  });
}

function Probe() {
  const { preferences, resolvedMode, setPreferences } = useAppearance();
  return (
    <div>
      <span data-testid="theme">{preferences.theme}</span>
      <span data-testid="mode">{preferences.mode}</span>
      <span data-testid="resolved">{resolvedMode}</span>
      <button onClick={() => setPreferences({ theme: "ochre" })}>
        pick ochre
      </button>
    </div>
  );
}

function renderProvider() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AppearanceProvider>
        <Probe />
      </AppearanceProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  systemDark = false;
  listeners.clear();
  installMatchMedia();
  localStorage.clear();
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ preferences: DEFAULT_PREFERENCES });
  sessionState.data = { user: { id: "u1" } };
  sessionState.isPending = false;
  document.documentElement.className = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AppearanceProvider", () => {
  it("paints from the local cache before the server responds", () => {
    localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_PREFERENCES, theme: "terminal" }),
    );
    // Never resolves — simulates a slow network.
    apiFetch.mockReturnValue(new Promise(() => {}));

    renderProvider();

    expect(screen.getByTestId("theme")).toHaveTextContent("terminal");
    expect(document.documentElement.dataset.theme).toBe("terminal");
  });

  it("lets the server value win over the cache", async () => {
    localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_PREFERENCES, theme: "terminal" }),
    );
    apiFetch.mockResolvedValue({
      preferences: { ...DEFAULT_PREFERENCES, theme: "aubergine" },
    });

    renderProvider();

    expect(await screen.findByText("aubergine")).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("aubergine");
  });

  it("re-caches the server value for the next cold load", async () => {
    apiFetch.mockResolvedValue({
      preferences: { ...DEFAULT_PREFERENCES, theme: "hoth" },
    });

    renderProvider();
    await screen.findByText("hoth");

    expect(
      JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY)!).theme,
    ).toBe("hoth");
  });

  // The 401-loop guard: these routes render outside a session.
  it("does not call the API when signed out", () => {
    sessionState.data = null;
    renderProvider();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("does not call the API while the session is still resolving", () => {
    sessionState.isPending = true;
    renderProvider();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("still themes signed-out routes from the cache", () => {
    sessionState.data = null;
    localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_PREFERENCES, theme: "banana" }),
    );

    renderProvider();

    expect(screen.getByTestId("theme")).toHaveTextContent("banana");
  });

  it("follows the OS live while mode is system", async () => {
    apiFetch.mockResolvedValue({
      preferences: { ...DEFAULT_PREFERENCES, mode: "system" },
    });

    renderProvider();
    await screen.findByText("system");
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");

    setSystemDark(true);

    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(document.documentElement).toHaveClass("dark");
  });

  it("ignores the OS once a mode is chosen explicitly", async () => {
    apiFetch.mockResolvedValue({
      preferences: { ...DEFAULT_PREFERENCES, mode: "light" },
    });

    renderProvider();
    await screen.findByText("light");

    setSystemDark(true);

    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("sends only the changed field, so siblings can't be clobbered", async () => {
    const user = userEvent.setup();
    renderProvider();
    await screen.findByTestId("theme");

    apiFetch.mockResolvedValue({
      preferences: { ...DEFAULT_PREFERENCES, theme: "ochre" },
    });
    await user.click(screen.getByRole("button", { name: "pick ochre" }));

    expect(apiFetch).toHaveBeenCalledWith("/api/preferences", {
      method: "PUT",
      body: { theme: "ochre" },
    });
  });

  it("applies a change immediately, before the request resolves", async () => {
    const user = userEvent.setup();
    renderProvider();
    await screen.findByTestId("theme");

    apiFetch.mockReturnValue(new Promise(() => {}));
    await user.click(screen.getByRole("button", { name: "pick ochre" }));

    expect(screen.getByTestId("theme")).toHaveTextContent("ochre");
  });

  it("drops the departing user's theme on sign-out", async () => {
    apiFetch.mockResolvedValue({
      preferences: { ...DEFAULT_PREFERENCES, theme: "aubergine" },
    });
    renderProvider();
    await screen.findByText("aubergine");

    act(() => clearCachedPreferences());

    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).toBeNull();
  });
});
