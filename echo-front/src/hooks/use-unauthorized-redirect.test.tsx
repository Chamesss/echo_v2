import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for the sign-out redirect loop.
 *
 * The bug: every 401 ran this handler, and the handler's FIRST act was
 * `queryClient.clear()`. Clearing drops the data out from under mounted
 * observers, which refetch immediately — so the queries that had just 401'd
 * (the still-mounted rail) fired again, 401'd again, and re-entered the handler.
 * Concurrent passes each ran their own session revalidation, letting a
 * `get-session` issued before the cookie died resolve after it and revive the
 * session atom, which bounced the user back into the app.
 *
 * The two invariants that break the cycle are asserted below: the burst
 * collapses into ONE pass, and the cache is cleared only AFTER the redirect.
 */

const navigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => navigate };
});
vi.mock("@/lib/auth-client", () => ({ useSession: vi.fn() }));

import { useSession } from "@/lib/auth-client";
import { UNAUTHORIZED_EVENT } from "@/lib/api";
import { useUnauthorizedRedirect } from "./use-unauthorized-redirect";

/** Records the interleaving of the redirect and the cache clear. */
let order: string[] = [];
let refetch: ReturnType<typeof vi.fn>;

function Harness() {
  useUnauthorizedRedirect();
  return null;
}

function mount(path = "/dashboard/w1") {
  window.history.replaceState({}, "", path);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(qc, "clear").mockImplementation(() => order.push("clear"));
  render(
    <QueryClientProvider client={qc}>
      <Harness />
    </QueryClientProvider>,
  );
  return qc;
}

const fire = () => window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));

beforeEach(() => {
  order = [];
  navigate.mockReset().mockImplementation(() => order.push("navigate"));
  // Resolve on a later tick so concurrent handlers would overlap if unguarded.
  refetch = vi.fn().mockImplementation(() => new Promise((r) => setTimeout(r, 5)));
  vi.mocked(useSession).mockReturnValue({ data: null, isPending: false, refetch } as never);
});

describe("useUnauthorizedRedirect", () => {
  it("collapses a burst of 401s into a single revalidation and redirect", async () => {
    mount();

    // Several queries 401 in the same tick — exactly what sign-out produced.
    fire();
    fire();
    fire();
    fire();

    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    // The guard is the point: one in-flight revalidation, so a stale
    // get-session can't land after the cookie died and revive the session.
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("clears the cache only after redirecting, so mounted queries can't refetch", async () => {
    mount();

    fire();

    await waitFor(() => expect(order).toContain("clear"));
    // Clearing first is what re-armed the still-mounted observers and fed the loop.
    expect(order).toEqual(["navigate", "clear"]);
  });

  it("still clears but does not redirect when already on a public auth page", async () => {
    mount("/login");

    fire();

    await waitFor(() => expect(order).toEqual(["clear"]));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("handles a later 401 after an earlier burst has settled", async () => {
    mount();

    fire();
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));

    // The guard must release once the pass finishes — a genuinely new
    // expiry later in the session still has to redirect.
    fire();
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(2));
  });
});
