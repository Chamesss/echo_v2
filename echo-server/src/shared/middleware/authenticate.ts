import type { RequestHandler } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../../infrastructure/auth/auth.js';
import { UnauthorizedError } from '../errors/app-error.js';

declare global {
  namespace Express {
    interface Request {
      user: { id: string; email: string; name: string };
    }
  }
}

/**
 * Resolves the session cookie attached to the request and populates `req.user`.
 *
 * Mounted in app.ts on every route family that requires a logged-in user.
 * Must run before `loadWorkspace`, which depends on `req.user.id`.
 *
 * The session lookup goes through the same Better Auth instance that serves
 * /api/auth/* — sign-in writes a session, this middleware reads it, sign-out
 * deletes it. Anyone who isn't signed in (no cookie, expired cookie, revoked
 * session) gets a 401 from the central error handler.
 *
 * `disableCookieCache: true` is load-bearing. Better Auth's `session.cookieCache`
 * (see auth.ts) serves `getSession` from a signed 5-minute cookie WITHOUT a DB
 * lookup. That's fine for low-stakes UI reads, but this middleware is the
 * authorization gate for the app's own API — if it trusted the cache, a session
 * revoked from another device (or expired server-side) would keep working here
 * for up to 5 minutes, out of sync with Better Auth's own DB-validated write
 * endpoints. Forcing a fresh lookup makes revocation take effect on the very
 * next request: it 401s, `apiFetch` fires `auth:unauthorized`, and the frontend
 * bounces to /login. (Better Auth's sensitive endpoints do the same internally.)
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
      query: { disableCookieCache: true },
    });

    if (!session?.user) {
      throw new UnauthorizedError('Not authenticated', 'no_session');
    }

    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    };
    next();
  } catch (err) {
    next(err);
  }
};
