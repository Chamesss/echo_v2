import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';

declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

/**
 * Assigns a UUID to every request and exposes it as `req.id`.
 *
 * Mounted as the first middleware in `app.ts` so it runs before anything else
 * that might log or fail. Used by [error-handler.ts] and the logger so log
 * lines can be correlated to a single request, and echoed back via the
 * `X-Request-Id` response header for client-side / support debugging.
 *
 * If the client supplies `X-Request-Id`, we honor it — useful for tracing a
 * request that fans out through multiple services.
 */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  req.id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};
