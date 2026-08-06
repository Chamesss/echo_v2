import type { RequestHandler } from "express";
import { TooManyRequestsError } from "../errors/app-error.js";
import { ErrorCode } from "../errors/error-codes.js";

/**
 * Fixed-window rate limiter for REST writes — an abuse backstop, not a fairness
 * throttle. In-memory, so per-instance; counters reset on deploy.
 */
interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

interface Window {
  start: number;
  count: number;
}

const SWEEP_INTERVAL_MS = 60_000;

/** Each call gets its own bucket map, so mounts never share a budget. */
export function rateLimit({ limit, windowMs }: RateLimitOptions): RequestHandler {
  const windows = new Map<string, Window>();

  // Without the sweep the map grows with every caller ever seen.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, w] of windows) {
      if (w.start <= cutoff) windows.delete(key);
    }
  }, SWEEP_INTERVAL_MS);
  sweep.unref();

  return (req, res, next) => {
    // Per user, not per IP — an office behind one NAT would share a budget.
    const key = req.user?.id ?? req.ip ?? "unknown";
    const now = Date.now();
    const current = windows.get(key);

    if (!current || now - current.start >= windowMs) {
      windows.set(key, { start: now, count: 1 });
      return next();
    }

    if (current.count >= limit) {
      const retryAfterMs = current.start + windowMs - now;
      // Never 0 — that invites an immediate retry guaranteed to fail.
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
      return next(
        new TooManyRequestsError(
          "You're going a bit fast — please slow down and try again shortly.",
          ErrorCode.TooManyRequests,
        ),
      );
    }

    current.count += 1;
    next();
  };
}

/** 5/sec sustained — far past mashing send. Load tests bypass HTTP, so unaffected. */
export const SEND_MESSAGE_LIMIT: RateLimitOptions = {
  limit: 300,
  windowMs: 60_000,
};

/** Channel/DM/invite creation: each is a deliberate act behind a dialog. */
export const CREATE_LIMIT: RateLimitOptions = {
  limit: 30,
  windowMs: 60_000,
};
