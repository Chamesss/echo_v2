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
  InsufficientWorkspaceRole: "insufficient_workspace_role",
  MissingAuthHeader: "missing_auth",
  UnknownUser: "unknown_user",

  // ─── Resource ────────────────────────────────────────────────────
  NotFound: "not_found",
  WorkspaceNotProvisioned: "workspace_not_provisioned",
  MissingWorkspaceId: "missing_workspace_id",
  Conflict: "conflict",
  SlugTaken: "slug_taken",
  UnknownOwner: "unknown_owner",

  // ─── Membership / invites ────────────────────────────────────────
  AlreadyAMember: "already_a_member",
  CannotModifyOwner: "cannot_modify_owner",
  NotWorkspaceOwner: "not_workspace_owner",
  InviteNotFound: "invite_not_found",
  InviteExpired: "invite_expired",
  InviteAlreadyAccepted: "invite_already_accepted",
  InviteEmailMismatch: "invite_email_mismatch",

  // ─── Channels / messages ─────────────────────────────────────────
  ChannelNotFound: "channel_not_found",
  NotAChannelMember: "not_a_channel_member",
  CannotManageChannel: "cannot_manage_channel",
  ChannelArchived: "channel_archived",
  /** The operation is meaningless or unsafe on a direct/group conversation. */
  NotAllowedOnConversation: "not_allowed_on_conversation",
  /** Tried to change who is in a 1:1 — start a group conversation instead. */
  DirectMessageIsFixed: "direct_message_is_fixed",
  MessageNotFound: "message_not_found",
  NotMessageAuthor: "not_message_author",

  // ─── Attachments ─────────────────────────────────────────────────
  AttachmentTooLarge: "attachment_too_large",
  TooManyAttachments: "too_many_attachments",
  AttachmentUploadIncomplete: "attachment_upload_incomplete",
  InvalidAttachmentRef: "invalid_attachment_ref",

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
