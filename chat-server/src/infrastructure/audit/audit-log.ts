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

export interface AuditEventInput {
  userId?: string | null;
  event: AuthEventName | string;
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
