import crypto from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { corsOrigins } from "../../config/env.js";
import { controlDb } from "../../infrastructure/database/control/client.js";
import {
  inviteTokens,
  memberships,
  users,
  workspaces,
} from "../../infrastructure/database/control/schema.js";
import { emitWorkspaceEvent, RealtimeEvents } from "../../infrastructure/realtime/events.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../shared/errors/app-error.js";
import { ErrorCode } from "../../shared/errors/error-codes.js";
import { invalidateDirectory } from "./directory.service.js";

/**
 * Tokenized email-invite flow. The raw token is emailed and never stored — only
 * its SHA-256 hash lives in `invite_tokens`, so a DB leak can't yield usable
 * links. Invites are single-use (`acceptedAt`) and expire after 7 days.
 */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Sentinel `invite_tokens.email` marking the one-off PUBLIC showcase link:
 * reusable, addressed to nobody, dated year 9999 so it never expires. It rides
 * the email column instead of getting a table, which is only safe because it
 * can't be minted through the normal flow — "*" fails `createInviteBody`'s
 * `.email()` at the edge, and `createInvite` rejects it again below. Only
 * `bun run db:seed-showcase` writes one.
 *
 * It never leaves the server: `getInviteByToken` maps it to `email: null` +
 * `isPublic: true`, so no client compares against "*".
 */
export const PUBLIC_INVITE_EMAIL = "*";

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Build the frontend accept link from the first configured CORS origin. */
function acceptUrl(token: string): string {
  const base = (corsOrigins[0] ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/accept-invite/${token}`;
}

export interface CreatedInvite {
  id: string;
  email: string;
  role: "admin" | "member";
  token: string; // raw — for emailing only, never persisted
  url: string;
  expiresAt: string;
}

export async function createInvite(
  workspaceId: string,
  invitedBy: string,
  input: { email: string; role: "admin" | "member" },
): Promise<CreatedInvite> {
  // Defense in depth beneath `createInviteBody`'s `.email()` check: the public
  // sentinel must never be mintable through the ordinary admin invite flow,
  // even by a caller that skipped the DTO.
  if (input.email === PUBLIC_INVITE_EMAIL) {
    throw new BadRequestError("That address is reserved", ErrorCode.BadRequest);
  }

  // Reject if someone with this email is already a member.
  const [already] = await controlDb
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.workspaceId, workspaceId), eq(users.email, input.email)))
    .limit(1);
  if (already) throw new ConflictError("That person is already a member", ErrorCode.AlreadyAMember);

  // Supersede any prior unaccepted invite for the same email + workspace.
  await controlDb
    .delete(inviteTokens)
    .where(
      and(
        eq(inviteTokens.workspaceId, workspaceId),
        eq(inviteTokens.email, input.email),
        isNull(inviteTokens.acceptedAt),
      ),
    );

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const [row] = await controlDb
    .insert(inviteTokens)
    .values({
      workspaceId,
      email: input.email,
      role: input.role,
      tokenHash: hashToken(token),
      invitedBy,
      expiresAt,
    })
    .returning({ id: inviteTokens.id });

  return {
    id: row!.id,
    email: input.email,
    role: input.role,
    token,
    url: acceptUrl(token),
    expiresAt: expiresAt.toISOString(),
  };
}

export interface InviteInfo {
  /**
   * Who the invite is addressed to, or `null` for a public link (addressed to
   * nobody). Never the raw sentinel — see `PUBLIC_INVITE_EMAIL`.
   */
  email: string | null;
  /** A reusable, non-expiring link anyone may follow. */
  isPublic: boolean;
  role: "admin" | "member";
  workspaceId: string;
  workspaceSlug: string;
  invitedByName: string | null;
  expiresAt: string;
  status: "pending" | "expired" | "accepted";
}

export async function getInviteByToken(token: string): Promise<InviteInfo> {
  const [row] = await controlDb
    .select({
      email: inviteTokens.email,
      role: inviteTokens.role,
      workspaceId: inviteTokens.workspaceId,
      acceptedAt: inviteTokens.acceptedAt,
      expiresAt: inviteTokens.expiresAt,
      workspaceSlug: workspaces.slug,
      invitedByName: users.name,
    })
    .from(inviteTokens)
    .innerJoin(workspaces, eq(workspaces.id, inviteTokens.workspaceId))
    .leftJoin(users, eq(users.id, inviteTokens.invitedBy))
    .where(eq(inviteTokens.tokenHash, hashToken(token)))
    .limit(1);
  if (!row) throw new NotFoundError("Invitation not found", ErrorCode.InviteNotFound);

  // A public link is never "accepted" — it's reusable, so `acceptedAt` stays
  // null on it forever. Expiry still applies (its row is just dated year 9999).
  const isPublic = row.email === PUBLIC_INVITE_EMAIL;
  const status: InviteInfo["status"] =
    !isPublic && row.acceptedAt
      ? "accepted"
      : row.expiresAt.getTime() < Date.now()
        ? "expired"
        : "pending";

  return {
    email: isPublic ? null : row.email,
    isPublic,
    role: row.role,
    workspaceId: row.workspaceId,
    workspaceSlug: row.workspaceSlug,
    invitedByName: row.invitedByName ?? null,
    expiresAt: row.expiresAt.toISOString(),
    status,
  };
}

export interface PendingInvite {
  id: string;
  email: string;
  role: "admin" | "member";
  expiresAt: string;
}

export async function listPendingInvites(workspaceId: string): Promise<PendingInvite[]> {
  const rows = await controlDb
    .select({
      id: inviteTokens.id,
      email: inviteTokens.email,
      role: inviteTokens.role,
      expiresAt: inviteTokens.expiresAt,
    })
    .from(inviteTokens)
    .where(
      and(
        eq(inviteTokens.workspaceId, workspaceId),
        isNull(inviteTokens.acceptedAt),
        gt(inviteTokens.expiresAt, new Date()),
      ),
    )
    .orderBy(inviteTokens.createdAt);
  return rows.map((r) => ({ ...r, expiresAt: r.expiresAt.toISOString() }));
}

export interface AcceptResult {
  workspaceId: string;
  role: "admin" | "member";
}

export async function acceptInvite(
  token: string,
  user: { id: string; email: string },
): Promise<AcceptResult> {
  const result = await controlDb.transaction(async (tx) => {
    // Lock the invite row so a double-click can't accept it twice.
    const [row] = await tx
      .select()
      .from(inviteTokens)
      .where(eq(inviteTokens.tokenHash, hashToken(token)))
      .limit(1)
      .for("update");
    if (!row) throw new NotFoundError("Invitation not found", ErrorCode.InviteNotFound);

    // The single-use and email-match gates are what make an EMAIL invite
    // private; the public link is addressed to nobody and meant to be reused, so
    // both are skipped for it. Expiry still applies to both, so no path here
    // ignores expiry entirely.
    const isPublic = row.email === PUBLIC_INVITE_EMAIL;
    if (!isPublic && row.acceptedAt) {
      throw new ConflictError("Invitation already used", ErrorCode.InviteAlreadyAccepted);
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new ForbiddenError("Invitation has expired", ErrorCode.InviteExpired);
    }
    if (!isPublic && row.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenError(
        "This invitation was sent to a different email address",
        ErrorCode.InviteEmailMismatch,
      );
    }

    await tx
      .insert(memberships)
      .values({ userId: user.id, workspaceId: row.workspaceId, role: row.role })
      .onConflictDoNothing();

    // Burning the token is exactly what makes an email invite single-use, so the
    // public link must never be marked accepted.
    if (!isPublic) {
      await tx
        .update(inviteTokens)
        .set({ acceptedAt: new Date() })
        .where(eq(inviteTokens.id, row.id));
    }

    invalidateDirectory(row.workspaceId);
    return { workspaceId: row.workspaceId, role: row.role };
  });

  // After commit: tell the workspace a member joined so live clients refresh the
  // roster and un-hide any messages this user authored before a prior departure.
  await emitWorkspaceEvent(result.workspaceId, RealtimeEvents.memberAdded(user.id, result.role));
  return result;
}
