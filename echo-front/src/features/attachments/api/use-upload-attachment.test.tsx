import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: vi.fn() };
});
import { apiFetch } from "@/lib/api";
import { useAttachmentUploads } from "./use-upload-attachment";

const POLICY = {
  maxPerMessage: 2,
  categories: [
    { category: "image", mimeTypes: ["image/png"], maxBytes: 25 * 1024 * 1024, render: "image" },
    { category: "file", mimeTypes: "*", maxBytes: 50 * 1024 * 1024, render: "file" },
  ],
};

/** A fake XHR that reports 100% progress then succeeds synchronously. */
class FakeXHR {
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 200;
  open() {}
  setRequestHeader() {}
  send() {
    this.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
    this.onload?.();
  }
}

function wrapper() {
  const qc = new QueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function fakeFile(name: string, type: string, size: number): File {
  return { name, type, size } as unknown as File;
}

beforeEach(() => {
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation(async (path: string) => {
    if (path.endsWith("/attachments/policy")) return POLICY;
    if (path.includes("/attachments/presign")) {
      return {
        uploadUrl: "https://put.example",
        key: "echo/workspaces/w/channels/c/u/abc.png",
        publicUrl: "https://bucket.example/abc.png",
        requiredHeaders: {},
      };
    }
    throw new Error(`unexpected apiFetch ${path}`);
  });
});

describe("useAttachmentUploads", () => {
  it("uploads a file: presign → PUT → done with key/url/category", async () => {
    const { result } = renderHook(() => useAttachmentUploads("w", "c"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.maxPerMessage).toBe(2)); // policy loaded

    act(() => result.current.addFiles([fakeFile("p.png", "image/png", 1000)]));

    await waitFor(() => expect(result.current.doneItems).toHaveLength(1));
    expect(result.current.doneItems[0]).toMatchObject({
      status: "done",
      key: "echo/workspaces/w/channels/c/u/abc.png",
      url: "https://bucket.example/abc.png",
      category: "image",
    });
    expect(result.current.hasUploading).toBe(false);
  });

  it("rejects an over-cap file client-side without uploading", async () => {
    const { result } = renderHook(() => useAttachmentUploads("w", "c"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.maxPerMessage).toBe(2));

    act(() => result.current.addFiles([fakeFile("big.png", "image/png", 99 * 1024 * 1024)]));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]!.status).toBe("error");
    expect(result.current.doneItems).toHaveLength(0);
  });

  it("caps the number of files at maxPerMessage", async () => {
    const { result } = renderHook(() => useAttachmentUploads("w", "c"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.maxPerMessage).toBe(2));

    act(() =>
      result.current.addFiles([
        fakeFile("a.png", "image/png", 10),
        fakeFile("b.png", "image/png", 10),
        fakeFile("c.png", "image/png", 10),
      ]),
    );

    await waitFor(() => expect(result.current.items).toHaveLength(2)); // 3rd dropped
  });
});
