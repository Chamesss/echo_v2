import { Router } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { auth } from '../../infrastructure/auth/auth.js';

/**
 * Mounts Better Auth's HTTP handler at /api/auth/* (see app.ts).
 *
 * Better Auth ships a single handler that internally routes all its
 * endpoints — /sign-up/email, /sign-in/email, /sign-out, /get-session,
 * /forget-password, etc. We don't define those routes; the library does.
 * `toNodeHandler` adapts its Web-Request-based handler to Express.
 *
 * IMPORTANT: this router must be mounted BEFORE `express.json()`. Better
 * Auth parses its own request body; if express has already consumed it,
 * the handler sees an empty body and every request fails silently.
 */
export const authRouter = Router();

authRouter.all('/*', toNodeHandler(auth));
