/**
 * Domain error classes thrown by services + middleware and caught by
 * `errorHandler`.
 *
 * Used wherever a request needs to fail with a specific HTTP status without
 * coupling the throwing code to Express. The error handler middleware
 * ([shared/errors/error-handler.ts]) maps each class to its status code +
 * JSON body.
 *
 * Add a subclass here instead of throwing plain `Error` — bare errors surface
 * as opaque 500s and leak stack traces.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, code = 'bad_request') {
    super(message, 400, code);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', code = 'unauthorized') {
    super(message, 401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code = 'forbidden') {
    super(message, 403, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', code = 'not_found') {
    super(message, 404, code);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'conflict') {
    super(message, 409, code);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message: string, code = 'too_many_requests') {
    super(message, 429, code);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service unavailable', code = 'service_unavailable') {
    super(message, 503, code);
  }
}
