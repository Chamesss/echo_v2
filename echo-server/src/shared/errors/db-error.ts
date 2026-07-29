import {
  AppError,
  BadRequestError,
  ConflictError,
  ServiceUnavailableError,
} from "./app-error.js";
import { ErrorCode } from "./error-codes.js";

/**
 * Postgres SQLSTATE class codes we care about.
 *
 * Full list: https://www.postgresql.org/docs/current/errcodes-appendix.html
 * Add cases here as new constraint types surface in services.
 */
const PgErrorCode = {
  UniqueViolation: "23505",
  ForeignKeyViolation: "23503",
  CheckViolation: "23514",
  NotNullViolation: "23502",
  // Connection-class errors — surface as 503 so clients/proxies can retry
  ConnectionException: "08000",
  ConnectionDoesNotExist: "08003",
  ConnectionFailure: "08006",
  CannotConnectNow: "57P03",
} as const;

interface PgErrorShape {
  code: string;
  constraint?: string;
  detail?: string;
  table?: string;
  column?: string;
}

function isPgError(err: unknown): err is PgErrorShape {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  );
}

/**
 * Translates a low-level driver error into a typed `AppError`.
 *
 * Called by `errorHandler` as the first pass when an unknown error reaches
 * the middleware. Services CAN catch specific Postgres errors inline when
 * they want a feature-specific message (see `workspaces.service.ts` for
 * the `slug_taken` override), but that's optional — if a service lets a
 * `23505` bubble, this translator gives a generic `409 db_unique_violation`
 * with the constraint name embedded so the client can still react.
 *
 * Returns `null` when the error isn't a recognised Postgres error so the
 * caller can fall through to its next strategy.
 */
export function translateDbError(err: unknown): AppError | null {
  if (!isPgError(err)) return null;

  const detail = err.detail ? ` (${err.detail})` : "";
  const constraint = err.constraint ? ` "${err.constraint}"` : "";

  switch (err.code) {
    case PgErrorCode.UniqueViolation:
      return new ConflictError(
        `Duplicate value violates unique constraint${constraint}${detail}`,
        ErrorCode.DbUniqueViolation,
      );

    case PgErrorCode.ForeignKeyViolation:
      return new BadRequestError(
        `Referenced resource does not exist${constraint}${detail}`,
        ErrorCode.DbForeignKeyViolation,
      );

    case PgErrorCode.CheckViolation:
      return new BadRequestError(
        `Value violates check constraint${constraint}`,
        ErrorCode.DbCheckViolation,
      );

    case PgErrorCode.NotNullViolation:
      return new BadRequestError(
        `Missing required value${err.column ? ` for column "${err.column}"` : ""}`,
        ErrorCode.DbNotNullViolation,
      );

    case PgErrorCode.ConnectionException:
    case PgErrorCode.ConnectionDoesNotExist:
    case PgErrorCode.ConnectionFailure:
    case PgErrorCode.CannotConnectNow:
      return new ServiceUnavailableError(
        "Database is temporarily unavailable",
        ErrorCode.DbConnectionError,
      );

    default:
      return null;
  }
}
