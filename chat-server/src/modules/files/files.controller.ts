import type { Request, Response } from "express";
import { s3Service } from "../../infrastructure/storage/s3-service.js";
import { isProxyableKey } from "./files.service.js";

/** Short TTL — a fresh signature is minted on every load through this redirect. */
const REDIRECT_TTL_SECONDS = 10 * 60;

/**
 * Public signed-redirect for the private-bucket objects this app owns (avatars
 * + chat attachments). Validates the key is in our `chat/` namespace — so it can
 * never sign another app's objects in the shared bucket — then 302s to a
 * freshly-signed, short-lived S3 GET. Stable URL in, fresh signature out: stored
 * URLs (avatar `image`, attachment wires) never expire.
 *
 * Intentionally unauthenticated: the object key is the bearer (chat keys carry
 * unguessable uuids), mirroring the previous inline-signed-URL model but without
 * the expiry problem. This lets `<img>`/`<video>` load it cross-origin without
 * needing the session cookie.
 */
export async function fileRedirectController(req: Request, res: Response): Promise<void> {
  const key = typeof req.query.key === "string" ? req.query.key : "";
  if (!key || !isProxyableKey(key)) {
    res.status(400).json({ error: { code: "bad_request", message: "Invalid file key" } });
    return;
  }
  if (!s3Service.isConfigured()) {
    res.status(404).json({
      error: { code: "uploads_not_configured", message: "File storage is not configured" },
    });
    return;
  }
  const url = await s3Service.getDownloadUrl(key, REDIRECT_TTL_SECONDS);
  // Override helmet's default `Cross-Origin-Resource-Policy: same-origin` for
  // this endpoint: it's loaded by <img>/<video>/<audio> on the (cross-origin)
  // frontend, and `same-origin` makes the browser block the embed — the image
  // appears broken even though opening the URL directly works. `cross-origin`
  // lets the SPA host embed it.
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  // Allow a short private cache, but never longer than the signature lives.
  res.setHeader("Cache-Control", "private, max-age=300");
  res.redirect(302, url);
}
