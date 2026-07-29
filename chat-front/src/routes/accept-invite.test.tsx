import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: vi.fn() };
});
vi.mock("@/lib/auth-client", () => ({ useSession: vi.fn(), signOut: vi.fn() }));

import { apiFetch } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import AcceptInvitePage from "./accept-invite";

const INVITE = {
  email: "invited@example.com",
  role: "member" as const,
  workspaceId: "w1",
  workspaceSlug: "acme",
  invitedByName: "Owner",
  expiresAt: "2999-01-01T00:00:00.000Z",
  status: "pending" as "pending" | "expired" | "accepted",
};

/** apiFetch that returns the invite on GET and an accept result on POST. */
function mockApi(invite = INVITE) {
  vi.mocked(apiFetch).mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith("/accept") ? { workspaceId: "w1", role: "member" } : invite,
    ) as never,
  );
}

const setSession = (data: unknown) =>
  vi.mocked(useSession).mockReturnValue({ data, isPending: false } as never);

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/accept-invite/tok"]}>
        <Routes>
          <Route path="/accept-invite/:token" element={<AcceptInvitePage />} />
          <Route path="/dashboard/:id" element={<div>workspace home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(useSession).mockReset();
  mockApi();
});

describe("AcceptInvitePage", () => {
  it("logged out → routes into sign-up / sign-in carrying the token", async () => {
    setSession(null);
    renderPage();

    const create = await screen.findByRole("link", { name: /create account/i });
    expect(create).toHaveAttribute("href", "/register?invite=tok");
    expect(screen.getByRole("link", { name: /already have an account/i })).toHaveAttribute(
      "href",
      "/login?invite=tok",
    );
    expect(screen.getByText("invited@example.com")).toBeInTheDocument();
    // No accept attempted while logged out.
    expect(apiFetch).not.toHaveBeenCalledWith(expect.stringContaining("/accept"), expect.anything());
  });

  it("logged in with a different email → shows the mismatch screen", async () => {
    setSession({ user: { id: "u2", email: "someone-else@example.com" } });
    renderPage();

    expect(await screen.findByText(/signed in with a different email/i)).toBeInTheDocument();
    expect(screen.getByText("someone-else@example.com")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith(expect.stringContaining("/accept"), expect.anything());
  });

  it("logged in with the matching email → auto-accepts", async () => {
    setSession({ user: { id: "u1", email: "Invited@Example.com" } }); // case-insensitive
    renderPage();

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        "/api/invites/tok/accept",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("expired invite → dead-end message", async () => {
    setSession(null);
    mockApi({ ...INVITE, status: "expired" });
    renderPage();
    expect(await screen.findByText(/expired/i)).toBeInTheDocument();
  });
});
