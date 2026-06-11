/**
 * Central catalog of error codes returned to clients.
 *
 * Every `AppError` carries a `code` that mirrors one of these constants. The
 * frontend's `ApiError` checks `code` to branch on specific failure modes
 * (e.g., `code === 'slug_taken'` → highlight the slug field instead of a
 * generic toast). Add a new code here instead of inventing strings inline
 * so the contract stays auditable and the frontend can keep up.
 *
 * Naming convention: snake_case, scoped by domain (`auth_*`, `db_*`,
 * `uploads_*`). Keep messages user-friendly; keep codes machine-stable.
 */
export const ErrorCode = {
  // ─── Validation ──────────────────────────────────────────────────
  ValidationFailed: "validation_failed",
  BadRequest: "bad_request",

  // ─── Auth ────────────────────────────────────────────────────────
  Unauthorized: "unauthorized",
  NoSession: "no_session",
  Forbidden: "forbidden",
  NotAMember: "not_a_member",
  MissingAuthHeader: "missing_auth",
  UnknownUser: "unknown_user",

  // ─── Resource ────────────────────────────────────────────────────
  NotFound: "not_found",
  WorkspaceNotProvisioned: "workspace_not_provisioned",
  MissingWorkspaceId: "missing_workspace_id",
  Conflict: "conflict",
  SlugTaken: "slug_taken",
  UnknownOwner: "unknown_owner",

  // ─── Channels / messages ─────────────────────────────────────────
  ChannelNotFound: "channel_not_found",
  NotAChannelMember: "not_a_channel_member",
  MessageNotFound: "message_not_found",
  NotMessageAuthor: "not_message_author",

  // ─── Rate limiting ───────────────────────────────────────────────
  TooManyRequests: "too_many_requests",

  // ─── Database (translated by `db-error.ts`) ─────────────────────
  DbUniqueViolation: "db_unique_violation",
  DbForeignKeyViolation: "db_foreign_key_violation",
  DbCheckViolation: "db_check_violation",
  DbNotNullViolation: "db_not_null_violation",
  DbConnectionError: "db_connection_error",

  // ─── External services ───────────────────────────────────────────
  UploadsNotConfigured: "uploads_not_configured",
  EmailNotConfigured: "email_not_configured",

  // ─── Fallbacks ───────────────────────────────────────────────────
  InternalError: "internal_error",
  ServiceUnavailable: "service_unavailable",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
