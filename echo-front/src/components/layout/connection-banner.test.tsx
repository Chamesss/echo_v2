import { render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeStatus } from "@/lib/reconnecting-socket";

/**
 * The banner is the only thing that tells a user realtime has stopped working.
 *
 * It matters more than it looks: sends go over REST, not the socket, so a dead
 * socket still lets you post messages. Without a visible signal the app looks
 * completely healthy while silently receiving nothing — which is why every
 * failure in this layer used to be indistinguishable from "quiet channel".
 */

const state = vi.hoisted(() => ({
  workspace: "open" as RealtimeStatus,
  user: "open" as RealtimeStatus,
  restartWorkspace: vi.fn(),
  restartUser: vi.fn(),
}));

vi.mock("@/features/channels/realtime/realtime-context", () => ({
  useRealtime: () => ({
    status: state.workspace,
    client: { restart: state.restartWorkspace },
  }),
}));

vi.mock("@/features/notifications/realtime/notifications-provider", () => ({
  useUserRealtimeStatus: () => ({ status: state.user, restart: state.restartUser }),
}));

import { ConnectionBanner } from "./connection-banner";

/** Render, then push past the debounce that suppresses brief blips. */
function renderSettled() {
  const result = render(<ConnectionBanner />);
  act(() => {
    vi.advanceTimersByTime(1_500);
  });
  return result;
}

beforeEach(() => {
  vi.useFakeTimers();
  state.workspace = "open";
  state.user = "open";
  state.restartWorkspace.mockClear();
  state.restartUser.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ConnectionBanner", () => {
  it("shows nothing while both sockets are healthy", () => {
    renderSettled();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not flash during a brief reconnect", () => {
    // A page refresh or a momentary blip reconnects in well under a second;
    // surfacing that would train users to ignore the banner entirely.
    state.workspace = "connecting";
    render(<ConnectionBanner />);

    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("reports a sustained reconnect", () => {
    state.workspace = "connecting";
    renderSettled();

    expect(screen.getByRole("status")).toHaveTextContent(/reconnecting/i);
  });

  it("reports a dead awareness socket even when the workspace socket is fine", () => {
    // The two sockets fail independently: this one carries unread counts and
    // notifications, so losing it is silent in a different way.
    state.workspace = "open";
    state.user = "closed";
    renderSettled();

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("offers a manual retry once a socket has stopped for good", () => {
    state.workspace = "stopped";
    renderSettled();

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/disconnected/i);

    act(() => {
      screen.getByRole("button", { name: /reconnect/i }).click();
    });

    expect(state.restartWorkspace).toHaveBeenCalled();
  });

  it("restarts only the socket that actually stopped", () => {
    state.workspace = "stopped";
    state.user = "open";
    renderSettled();

    act(() => {
      screen.getByRole("button", { name: /reconnect/i }).click();
    });

    expect(state.restartWorkspace).toHaveBeenCalled();
    expect(state.restartUser).not.toHaveBeenCalled();
  });

  it("shows no retry while a reconnect is still in progress", () => {
    // "Reconnecting" is transient and self-healing; a button there would invite
    // people to interrupt a recovery that was already working.
    state.workspace = "closed";
    renderSettled();

    expect(screen.queryByRole("button", { name: /reconnect/i })).not.toBeInTheDocument();
  });

  it("clears once the connection comes back", () => {
    state.workspace = "connecting";
    const { rerender } = renderSettled();
    expect(screen.getByRole("status")).toBeInTheDocument();

    state.workspace = "open";
    act(() => {
      rerender(<ConnectionBanner />);
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
