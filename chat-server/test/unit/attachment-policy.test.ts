import { describe, expect, it } from "vitest";
import {
  clientPolicy,
  resolveCategory,
  validateUpload,
} from "../../src/modules/attachments/attachment-policy.js";

/**
 * Pure policy tests (no I/O). The policy is the single source of truth for which
 * files are allowed and how they're treated, so its category resolution + caps
 * are worth pinning down directly.
 */
describe("attachment policy", () => {
  it("resolves known media/doc types to their category", () => {
    expect(resolveCategory("image/png").category).toBe("image");
    expect(resolveCategory("image/jpeg").category).toBe("image");
    expect(resolveCategory("video/mp4").category).toBe("video");
    expect(resolveCategory("audio/mpeg").category).toBe("audio");
    expect(resolveCategory("application/pdf").category).toBe("document");
  });

  it("routes SVG / HTML / unknown types to the download-only `file` category", () => {
    for (const mime of ["image/svg+xml", "text/html", "application/x-msdownload"]) {
      const p = resolveCategory(mime);
      expect(p.category).toBe("file");
      expect(p.forceDownload).toBe(true); // never executes inline
      expect(p.render).toBe("file");
    }
  });

  it("is case-insensitive on MIME", () => {
    expect(resolveCategory("IMAGE/PNG").category).toBe("image");
  });

  it("accepts a within-cap upload and returns the category", () => {
    expect(validateUpload({ contentType: "image/png", contentLength: 1024 }).category).toBe("image");
  });

  it("rejects an over-cap upload", () => {
    expect(() =>
      validateUpload({ contentType: "image/png", contentLength: 999 * 1024 * 1024 }),
    ).toThrow();
  });

  it("exposes a client policy with categories + a trailing `*` fallback", () => {
    const p = clientPolicy();
    expect(p.maxPerMessage).toBeGreaterThan(0);
    expect(p.categories.map((c) => c.category)).toContain("image");
    expect(p.categories.at(-1)?.mimeTypes).toBe("*"); // fallback last
    for (const c of p.categories) expect(c.maxBytes).toBeGreaterThan(0);
  });
});
