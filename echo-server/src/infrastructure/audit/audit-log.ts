import { controlDb } from "../database/control/client.js";
import { authEvents } from "../database/control/schema.js";
import { logger } from "../../shared/logger/logger.js";

/**
 * Domain event names recorded in `auth_events`.
 *
 * Use the constants instead of bare strings so misspellings surface at
 * compile time and downstream analytics queries have a stable enumeration.
 * Add new events here as the auth surface grows (channel deletion,
 * impersonation, etc.).
 */
export const AuthEventName = {
  UserCreated: "user.created",
  SessionCreated: "session.created",
  SessionRevoked: "session.revoked",
  PasswordChanged: "password.changed",
  PasswordResetRequested: "password.reset_requested",
  TwoFactorEnabled: "two_factor.enabled",
  TwoFactorDisabled: "two_factor.disabled",
  EmailChangeRequested: "email.change_requested",
  AccountDeleted: "account.deleted",
} as const;

export type AuthEventName = (typeof AuthEventName)[keyof typeof AuthEventName];

/**
 * Workspace/channel admin events. Recorded in the same `auth_events` table —
 * the audit surface the table was always meant to grow into (see its schema
 * comment) — but with the affected `workspaceId` folded into `metadata` by
 * `logWorkspaceEvent`. These are the security-relevant structural changes an
 * enterprise admin needs a forensic trail of: who created/deleted a channel,
 * who invited/removed a member, who changed a role.
 */
export const WorkspaceEventName = {
  ChannelCreated: "channel.created",
  ChannelRenamed: "channel.renamed",
  ChannelArchived: "channel.archived",
  ChannelDeleted: "channel.deleted",
  MemberInvited: "member.invited",
  MemberAdded: "member.added",
  MemberRemoved: "member.removed",
  MemberRoleChanged: "member.role_changed",
  MemberLeft: "member.left",
  WorkspaceRenamed: "workspace.renamed",
  WorkspaceDeleted: "workspace.deleted",
} as const;

export type WorkspaceEventName = (typeof WorkspaceEventName)[keyof typeof WorkspaceEventName];

export interface AuditEventInput {
  userId?: string | null;
  /**
   * A known `AuthEventName`, or any other string. `AuthEventName | string` (which
   * this was) collapses to plain `string`, advertising a constraint it never
   * enforced and losing the completions. `string & {}` keeps both.
   */
  event: AuthEventName | (string & {});
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Inserts one row into the `auth_events` audit log.
 *
 * Called from `infrastructure/auth/auth.ts` (`databaseHooks` on session +
 * user creation) and from any service that performs a security-relevant
 * action (password change, account delete, etc.).
 *
 * Errors are swallowed and logged: an audit-write failure must never break
 * the user-facing operation that triggered it. If audit reliability ever
 * matters more than that tradeoff, switch this to a queue-based writer.
 */
export async function logAuthEvent(input: AuditEventInput): Promise<void> {
  try {
    await controlDb.insert(authEvents).values({
      userId: input.userId ?? null,
      event: input.event,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadata: input.metadata ?? null,
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), input },
      "Failed to write audit event — continuing without it",
    );
  }
}

export interface WorkspaceAuditInput {
  userId: string;
  workspaceId: string;
  /** Same shape as `AuditEventInput.event` — see the note there. */
  event: WorkspaceEventName | (string & {});
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Records a workspace/channel admin action, folding `workspaceId` into the
 * event metadata so the audit trail is queryable per workspace. Thin wrapper
 * over `logAuthEvent` — same table, same swallow-on-failure guarantee.
 */
export async function logWorkspaceEvent(input: WorkspaceAuditInput): Promise<void> {
  await logAuthEvent({
    userId: input.userId,
    event: input.event,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    metadata: { workspaceId: input.workspaceId, ...(input.metadata ?? {}) },
  });
}
