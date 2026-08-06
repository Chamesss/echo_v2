import {
  AppError,
  BadRequestError,
  ConflictError,
  ServiceUnavailableError,
} from "./app-error.js";
import { ErrorCode } from "./error-codes.js";

/** https://www.postgresql.org/docs/current/errcodes-appendix.html */
const PgErrorCode = {
  UniqueViolation: "23505",
  ForeignKeyViolation: "23503",
  CheckViolation: "23514",
  NotNullViolation: "23502",
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

function hasPgShape(err: unknown): err is PgErrorShape {
  return typeof err === "object" && err !== null && "code" in err && typeof err.code === "string";
}

/**
 * Find the driver error, unwrapping whatever threw it.
 *
 * Drizzle wraps every failure in a `DrizzleQueryError` that carries no `code` of
 * its own — the SQLSTATE sits on `.cause`. Checking only the top-level error
 * therefore matched nothing on any query issued through drizzle, which is all of
 * the control-schema ones.
 */
function findPgError(err: unknown): PgErrorShape | null {
  for (let cur = err, depth = 0; cur != null && depth < 5; depth++) {
    if (hasPgShape(cur)) return cur;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

/** SQLSTATE 23505. Lets a service special-case a collision without re-deriving it. */
export function isUniqueViolation(err: unknown): boolean {
  return findPgError(err)?.code === PgErrorCode.UniqueViolation;
}

/**
 * Translates a driver error into a typed `AppError`, or `null` if unrecognised
 * so the caller can fall through.
 *
 * Messages are deliberately generic: `err.constraint` and `err.detail` name
 * internal schema objects and echo the offending row values
 * (`Key (slug)=(admin) already exists`), so they are logged by `errorHandler`
 * rather than returned. The STATUS and `ErrorCode` are the useful part — a
 * unique violation is a 409, not a 500.
 */
export function translateDbError(err: unknown): AppError | null {
  const pg = findPgError(err);
  if (!pg) return null;

  switch (pg.code) {
    case PgErrorCode.UniqueViolation:
      return new ConflictError("That value is already taken", ErrorCode.DbUniqueViolation);

    case PgErrorCode.ForeignKeyViolation:
      return new BadRequestError(
        "Referenced resource does not exist",
        ErrorCode.DbForeignKeyViolation,
      );

    case PgErrorCode.CheckViolation:
      return new BadRequestError("That value isn't allowed", ErrorCode.DbCheckViolation);

    case PgErrorCode.NotNullViolation:
      return new BadRequestError("A required value is missing", ErrorCode.DbNotNullViolation);

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
