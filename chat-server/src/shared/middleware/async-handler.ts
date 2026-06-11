import type { RequestHandler, Request, Response, NextFunction } from 'express';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Wraps an async controller so rejected promises propagate to the central
 * error middleware instead of crashing the process with an unhandled rejection.
 *
 * Used by every async controller registration in `modules/*\/*.routes.ts`:
 *   router.post('/', validate({...}), asyncHandler(controllerFn))
 *
 * Express 5 handles this natively; we're on 4.x where async errors don't
 * propagate automatically — this is the standard workaround.
 */
export const asyncHandler = (handler: AsyncHandler): RequestHandler => {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
};
