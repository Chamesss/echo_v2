import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "@/lib/api";
import { CreateWorkspaceForm } from "./CreateWorkspaceForm";

/**
 * Covers the "workspace slugs can't contain spaces" rule from the user's side:
 * typing a name with spaces must produce a usable slug, not a validation error.
 */
function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/workspaces/create"]}>
        <Routes>
          <Route path="/workspaces/create" element={<CreateWorkspaceForm />} />
          <Route path="/dashboard/:id" element={<div>workspace home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.getByRole("textbox") as HTMLInputElement;
}

/** The slug the last POST /api/workspaces call was made with. */
function submittedSlug(): string {
  const [, init] = vi.mocked(apiFetch).mock.calls.at(-1)!;
  return (init as { body: { slug: string } }).body.slug;
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockResolvedValue({
    workspaceId: "w1",
    schemaName: "tenant_acme_corp",
  } as never);
});

describe("CreateWorkspaceForm", () => {
  it("rewrites spaces to hyphens as the user types", async () => {
    const user = userEvent.setup();
    const input = renderForm();

    await user.type(input, "Acme Corp");

    expect(input.value).toBe("acme-corp");
  });

  it("submits the normalized slug instead of failing validation", async () => {
    const user = userEvent.setup();
    const input = renderForm();

    await user.type(input, "My Big Team");
    await user.click(screen.getByRole("button", { name: /create workspace/i }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(submittedSlug()).toBe("my-big-team");
    expect(screen.queryByText(/no spaces/i)).not.toBeInTheDocument();
  });

  it("drops the trailing hyphen a trailing space leaves behind", async () => {
    const user = userEvent.setup();
    const input = renderForm();

    // Enter-to-submit skips the field's blur tidying — the schema has to catch it.
    await user.type(input, "acme corp {enter}");

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(submittedSlug()).toBe("acme-corp");
  });

  it("still rejects a slug that normalization can't repair", async () => {
    const user = userEvent.setup();
    const input = renderForm();

    await user.type(input, "1st team");
    await user.click(screen.getByRole("button", { name: /create workspace/i }));

    expect(await screen.findByText(/must start with a letter/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
