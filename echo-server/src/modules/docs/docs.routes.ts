import { Router } from 'express';
import { apiReference } from '@scalar/express-api-reference';
import { buildOpenApiDocument } from '../../shared/openapi/document.js';

/**
 * Serves application API documentation. Mounted at `/api/docs` in `app.ts`.
 *
 *   GET /api/docs/openapi.json — combined OpenAPI 3.0 spec
 *   GET /api/docs              — Scalar's interactive reference UI
 *
 * The document is built lazily on first request and cached for the rest of
 * the process. Lazy because `buildOpenApiDocument` is async (it pulls Better
 * Auth's schema at startup), and we don't want module loading to depend on a
 * library call. The `tsx watch` dev script restarts on file changes, so
 * schema edits show up after a reload.
 *
 * Auth endpoints (sign-up, sign-in, session, password reset, etc.) are
 * merged in by document.ts. Better Auth still exposes its own standalone
 * reference at /api/auth/reference for comparison.
 */

/**
 * Lazy cache for the built OpenAPI document.
 *
 * Used only by `getDocument()` below. Kept as a promise (not the resolved
 * value) so concurrent first requests share a single in-flight build instead
 * of triggering the merge multiple times.
 */
let documentPromise: ReturnType<typeof buildOpenApiDocument> | null = null;

/**
 * Returns the cached OpenAPI document, building it on the first call.
 *
 * Called by the GET /openapi.json handler below. Errors during the build
 * propagate to the central error handler via `next(err)`.
 */
function getDocument() {
  if (!documentPromise) documentPromise = buildOpenApiDocument();
  return documentPromise;
}

export const docsRouter = Router();

docsRouter.get('/openapi.json', async (_req, res, next) => {
  try {
    res.json(await getDocument());
  } catch (err) {
    next(err);
  }
});

docsRouter.use(
  apiReference({
    spec: { url: '/api/docs/openapi.json' },
  }),
);
