import { describe, expect, it } from "vitest";
import {
  formatBytes,
  resolveClientCategory,
  type ClientPolicy,
} from "./use-attachment-policy";

const policy: ClientPolicy = {
  maxPerMessage: 10,
  categories: [
    {
      category: "image",
      mimeTypes: ["image/png", "image/jpeg"],
      maxBytes: 25 * 1024 * 1024,
      render: "image",
    },
    {
      category: "video",
      mimeTypes: ["video/mp4"],
      maxBytes: 200 * 1024 * 1024,
      render: "video",
    },
    {
      category: "file",
      mimeTypes: "*",
      maxBytes: 50 * 1024 * 1024,
      render: "file",
    },
  ],
};

describe("resolveClientCategory", () => {
  it("matches known types and falls back to the `*` category", () => {
    expect(resolveClientCategory(policy, "image/png").category).toBe("image");
    expect(resolveClientCategory(policy, "video/mp4").category).toBe("video");
    expect(resolveClientCategory(policy, "application/zip").category).toBe(
      "file",
    );
  });

  it("is case-insensitive", () => {
    expect(resolveClientCategory(policy, "IMAGE/PNG").category).toBe("image");
  });
});

describe("formatBytes", () => {
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
