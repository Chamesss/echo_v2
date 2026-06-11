import type { RequestHandler } from "express";
import type { ZodTypeAny } from "zod";

export interface ValidationSchemas {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
}

/**
 * Zod-based request validation middleware.
 *
 * Used by every route in `modules/*\/*.routes.ts` that takes input. Schemas
 * live in the module's `*.dto.ts` so request shape stays close to the feature
 * it belongs to.
 *
 * On success, the parsed (and stripped of unknown fields) value replaces
 * `req.body` / `req.params` / `req.query`, so controllers get typed input.
 * On failure, ZodError is thrown and the central error handler turns it into
 * a structured 400 response.
 *
 * Zod 4's `parse` on a generic `ZodTypeAny` returns `unknown`; we cast back
 * to the Express request-property types since the schema author owns the
 * shape contract here.
 */
export const validate = (schemas: ValidationSchemas): RequestHandler => {
  return (req, _res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as typeof req.params;
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query) as typeof req.query;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
};
