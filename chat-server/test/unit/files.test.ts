import type { Request, Response } from "express";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock S3 so nothing touches the real bucket / reads real creds.
const s3mock = vi.hoisted(() => ({
  isConfigured: vi.fn(() => true),
  getDownloadUrl: vi.fn(async (key: string) => `https://signed.example/${key}?sig=x`),
}));
vi.mock("../../src/infrastructure/storage/s3-service.js", () => ({ s3Service: s3mock }));

import { fileRedirectController } from "../../src/modules/files/files.controller.js";
import { fileProxyUrl, isProxyableKey } from "../../src/modules/files/files.service.js";

interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  redirectUrl?: string;
  status(code: number): FakeRes;
  json(b: unknown): FakeRes;
  setHeader(k: string, v: string): void;
  redirect(code: number, url: string): void;
}

function mockRes(): FakeRes {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
    redirect(code, url) {
      this.statusCode = code;
      this.redirectUrl = url;
    },
  };
}

const run = (key: unknown) =>
  fileRedirectController(
    { query: { key } } as unknown as Request,
    mockRes() as unknown as Response,
  );

describe("isProxyableKey", () => {
  it("accepts owned chat keys", () => {
    expect(isProxyableKey("chat/users/abc/avatar-1.png")).toBe(true);
    expect(isProxyableKey("chat/workspaces/w/channels/c/u/uuid.mp4")).toBe(true);
  });

  it("rejects other namespaces, traversal, and junk", () => {
    expect(isProxyableKey("auction/secret.pdf")).toBe(false); // shared-bucket sibling app
    expect(isProxyableKey("chat/../auction/secret.pdf")).toBe(false);
    expect(isProxyableKey("chat/has space.png")).toBe(false);
    expect(isProxyableKey("")).toBe(false);
  });
});

describe("fileProxyUrl", () => {
  it("builds a stable /api/files pointer with the key url-encoded", () => {
    const url = fileProxyUrl("chat/users/abc/avatar-1.png");
    expect(url).toContain("/api/files?key=");
    expect(url).toContain(encodeURIComponent("chat/users/abc/avatar-1.png"));
  });
});

describe("fileRedirectController", () => {
  beforeEach(() => {
    s3mock.isConfigured.mockReset().mockReturnValue(true);
    s3mock.getDownloadUrl.mockReset().mockResolvedValue("https://signed.example/k?sig=x");
  });

  it("302s an owned key to a freshly-signed GET", async () => {
    const res = mockRes();
    await fileRedirectController(
      { query: { key: "chat/users/abc/avatar-1.png" } } as unknown as Request,
      res as unknown as Response,
    );
    expect(s3mock.getDownloadUrl).toHaveBeenCalledWith("chat/users/abc/avatar-1.png", expect.any(Number));
    expect(res.statusCode).toBe(302);
    expect(res.redirectUrl).toBe("https://signed.example/k?sig=x");
    // Must be embeddable cross-origin or <img>/<video> on the SPA host break.
    expect(res.headers["Cross-Origin-Resource-Policy"]).toBe("cross-origin");
  });

  it("rejects an out-of-namespace/invalid key without signing", async () => {
    const res = mockRes();
    await fileRedirectController(
      { query: { key: "auction/secret.pdf" } } as unknown as Request,
      res as unknown as Response,
    );
    expect(res.statusCode).toBe(400);
    expect(s3mock.getDownloadUrl).not.toHaveBeenCalled();
  });

  it("404s when storage isn't configured", async () => {
    s3mock.isConfigured.mockReturnValue(false);
    const res = mockRes();
    await fileRedirectController(
      { query: { key: "chat/users/abc/avatar-1.png" } } as unknown as Request,
      res as unknown as Response,
    );
    expect(res.statusCode).toBe(404);
    expect(s3mock.getDownloadUrl).not.toHaveBeenCalled();
  });

  // keep `run` referenced for the missing-key path
  it("rejects a missing key", async () => {
    await run(undefined);
    expect(s3mock.getDownloadUrl).not.toHaveBeenCalled();
  });
});
