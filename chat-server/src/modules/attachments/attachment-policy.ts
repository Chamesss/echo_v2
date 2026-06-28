import { env } from "../../config/env.js";
import { BadRequestError } from "../../shared/errors/app-error.js";
import { ErrorCode } from "../../shared/errors/error-codes.js";

/**
 * Attachment policy — the single source of truth for what can be uploaded and
 * how it's treated. Pure (no I/O): the upload service, the send path, and the
 * client-facing policy endpoint all derive from this, so caps + allowed types
 * never drift. Caps are env-driven (see config/env.ts) so a deploy can tune
 * them without code changes.
 *
 * Model: every MIME type resolves to exactly one category. Known media/doc
 * types get tuned caps + inline rendering; anything else falls through to the
 * catch-all `file` category, which is download-only (`forceDownload`) so active
 * content (SVG/HTML/scripts) can never execute inline.
 */

export type AttachmentCategory = "image" | "video" | "audio" | "document" | "file";

/** How the client renders a category. `file` = a download chip (no inline). */
export type RenderMode = "image" | "video" | "audio" | "file";

export interface CategoryPolicy {
  category: AttachmentCategory;
  /** Allowed MIME types; the literal `"*"` marks the catch-all (must be last). */
  mimeTypes: readonly string[] | "*";
  maxBytes: number;
  render: RenderMode;
  /** Send `Content-Disposition: attachment` so it downloads, never executes inline. */
  forceDownload: boolean;
}

const MB = 1024 * 1024;

/**
 * Ordered list — the FIRST matching category wins, and the `"*"` fallback MUST
 * be last. `image/svg+xml` and `text/html` are intentionally absent from every
 * explicit list so they land in `file` (download-only) — XSS-safe.
 */
export const ATTACHMENT_POLICY: readonly CategoryPolicy[] = [
  {
    category: "image",
    mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    maxBytes: env.ATTACH_IMAGE_MAX_MB * MB,
    render: "image",
    forceDownload: false,
  },
  {
    category: "video",
    mimeTypes: ["video/mp4", "video/webm", "video/quicktime"],
    maxBytes: env.ATTACH_VIDEO_MAX_MB * MB,
    render: "video",
    forceDownload: false,
  },
  {
    category: "audio",
    mimeTypes: ["audio/mpeg", "audio/ogg", "audio/wav", "audio/webm", "audio/mp4"],
    maxBytes: env.ATTACH_AUDIO_MAX_MB * MB,
    render: "audio",
    forceDownload: false,
  },
  {
    category: "document",
    mimeTypes: [
      "application/pdf",
      "text/plain",
      "text/csv",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/zip",
    ],
    maxBytes: env.ATTACH_DOC_MAX_MB * MB,
    render: "file",
    forceDownload: false,
  },
  {
    category: "file",
    mimeTypes: "*",
    maxBytes: env.ATTACH_FILE_MAX_MB * MB,
    render: "file",
    forceDownload: true,
  },
];

export const MAX_ATTACHMENTS_PER_MESSAGE = env.ATTACH_MAX_PER_MESSAGE;

const FALLBACK = ATTACHMENT_POLICY[ATTACHMENT_POLICY.length - 1]!;

/** Resolve a MIME type to its category policy (always resolves — `file` catch-all). */
export function resolveCategory(contentType: string): CategoryPolicy {
  const mime = contentType.toLowerCase().trim();
  for (const p of ATTACHMENT_POLICY) {
    if (p.mimeTypes === "*") return p;
    if (p.mimeTypes.includes(mime)) return p;
  }
  return FALLBACK;
}

/**
 * Validate a declared upload against policy. Returns the resolved category
 * policy, or throws a clear (per-category) `BadRequestError` on an over-cap
 * size. Type is never rejected — unknown types resolve to `file`.
 */
export function validateUpload(input: { contentType: string; contentLength: number }): CategoryPolicy {
  const policy = resolveCategory(input.contentType);
  if (input.contentLength > policy.maxBytes) {
    throw new BadRequestError(
      `${policy.category} files must be under ${Math.round(policy.maxBytes / MB)} MB`,
      ErrorCode.AttachmentTooLarge,
    );
  }
  return policy;
}

/** Serializable policy view for the client (pre-validation + file-input hints). */
export function clientPolicy() {
  return {
    maxPerMessage: MAX_ATTACHMENTS_PER_MESSAGE,
    categories: ATTACHMENT_POLICY.map((p) => ({
      category: p.category,
      mimeTypes: p.mimeTypes === "*" ? ("*" as const) : [...p.mimeTypes],
      maxBytes: p.maxBytes,
      render: p.render,
    })),
  };
}

export type ClientPolicy = ReturnType<typeof clientPolicy>;
