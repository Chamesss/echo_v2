import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from './app-error.js';
import { translateDbError } from './db-error.js';
import { logger } from '../logger/logger.js';

/**
 * Centralized Express error middleware.
 *
 * Mounted last in `app.ts` so any error thrown (or `next(err)`-ed) from a
 * controller, middleware, or `asyncHandler`-wrapped handler funnels here.
 *
 * Why it exists: gives every error response a uniform JSON shape, prevents
 * stack traces from leaking to clients, and logs unexpected errors with the
 * request ID so they can be correlated with access logs.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_failed',
        message: 'Invalid request payload',
        issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }

  // A Postgres error that no service special-cased. The response carries only a
  // status + code; the constraint name and offending values stay in the log.
  const translated = translateDbError(err);
  if (translated) {
    logger.warn({ err: serializeError(err), requestId: req.id }, 'Database error');
    res.status(translated.statusCode).json({
      error: { code: translated.code, message: translated.message },
    });
    return;
  }

  logger.error({ err: serializeError(err), requestId: req.id }, 'Unhandled error');
  res.status(500).json({
    error: { code: 'internal_error', message: 'Internal server error' },
  });
};

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { value: String(err) };
}
