import { env } from "../../config/env.js";

/**
 * Helpers for the signed-redirect file endpoint (`GET /api/files`).
 *
 * Objects this app stores in the (shared) bucket all live under the `echo/`
 * namespace — avatars at `echo/users/...`, message attachments at
 * `echo/workspaces/...`. The redirect endpoint will only ever sign keys in this
 * namespace, so it can't be abused to mint URLs for another app's objects in
 * the same bucket.
 */

const OWNED_PREFIX = "echo/";
// Conservative key charset: our keys are uuids + a handful of path segments.
// Rejects anything with traversal (`..`), whitespace, or control characters.
const SAFE_KEY_RE = /^echo\/[A-Za-z0-9/_.-]+$/;

/** True when `key` is an object this app owns and is safe to sign. */
export function isProxyableKey(key: string): boolean {
  return key.startsWith(OWNED_PREFIX) && !key.includes("..") && SAFE_KEY_RE.test(key);
}

/**
 * Absolute, STABLE URL to the signed-redirect endpoint for an owned object key.
 * Stored in attachment wires (and avatars, client-side); each load 302s to a
 * freshly-signed S3 GET, so the stored URL never expires.
 */
export function fileProxyUrl(key: string): string {
  const base = env.BETTER_AUTH_URL.replace(/\/$/, "");
  return `${base}/api/files?key=${encodeURIComponent(key)}`;
}
