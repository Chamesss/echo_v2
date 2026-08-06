import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { controlDb } from "../../src/infrastructure/database/control/client.js";
import { inviteTokens, memberships } from "../../src/infrastructure/database/control/schema.js";
import { withTenantSchema } from "../../src/infrastructure/database/tenant/client.js";
import { joinChannel } from "../../src/modules/channels/channels.service.js";
import {
  addMemberByEmail,
  changeMemberRole,
  leaveWorkspace,
  listMembers,
  removeMember,
} from "../../src/modules/members/members.service.js";
import {
  acceptInvite,
  createInvite,
  getInviteByToken,
} from "../../src/modules/members/invites.service.js";
import { requireWorkspaceRole } from "../../src/shared/middleware/require-workspace-role.js";
import {
  AppError,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../src/shared/errors/app-error.js";
import {
  createUser,
  createWorkspace,
  makeChannel,
  type TestUser,
  type TestWorkspace,
} from "../factories.js";
import { teardown } from "../helpers/teardown.js";

let ownerA: TestUser;
let ownerB: TestUser;
let wsA: TestWorkspace;
let wsB: TestWorkspace;

beforeAll(async () => {
  ownerA = await createUser();
  ownerB = await createUser();
  wsA = await createWorkspace(ownerA.id);
  wsB = await createWorkspace(ownerB.id);
});

afterAll(() => teardown(wsA, wsB));

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const rows = await controlDb
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)));
  return rows.length > 0;
}

async function channelMemberCount(ws: TestWorkspace, userId: string): Promise<number> {
  return withTenantSchema(ws.workspaceId, async (db) => {
    const { rows } = await db.query<{ n: string }>(
      "SELECT count(*)::int AS n FROM channel_members WHERE user_id = $1",
      [userId],
    );
    return Number(rows[0]!.n);
  });
}

describe("add member by email", () => {
  it("adds an existing user, listed with their role and profile", async () => {
    const user = await createUser();
    const member = await addMemberByEmail(wsA.workspaceId, { email: user.email, role: "member" });
    expect(member.userId).toBe(user.id);
    expect(member.role).toBe("member");
    expect(member.isOwner).toBe(false);

    const roster = await listMembers(wsA.workspaceId);
    expect(roster.find((m) => m.userId === user.id)?.email).toBe(user.email);
  });

  it("rejects a duplicate add and an unknown email", async () => {
    const user = await createUser();
    await addMemberByEmail(wsA.workspaceId, { email: user.email, role: "member" });
    await expect(
      addMemberByEmail(wsA.workspaceId, { email: user.email, role: "member" }),
    ).rejects.toMatchObject({ code: "already_a_member" });
    await expect(
      addMemberByEmail(wsA.workspaceId, { email: "nobody@nowhere.test", role: "member" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("invite lifecycle", () => {
  it("create → view → accept makes the invitee a member; re-accept is rejected", async () => {
    const invitee = await createUser();
    const invite = await createInvite(wsA.workspaceId, ownerA.id, {
      email: invitee.email,
      role: "member",
    });

    const info = await getInviteByToken(invite.token);
    expect(info.status).toBe("pending");
    expect(info.email).toBe(invitee.email);
    expect(info.workspaceSlug).toBe(wsA.slug);

    const result = await acceptInvite(invite.token, { id: invitee.id, email: invitee.email });
    expect(result.workspaceId).toBe(wsA.workspaceId);
    expect(await isMember(wsA.workspaceId, invitee.id)).toBe(true);

    // Single-use: second accept fails.
    await expect(
      acceptInvite(invite.token, { id: invitee.id, email: invitee.email }),
    ).rejects.toMatchObject({ code: "invite_already_accepted" });
  });

  it("rejects acceptance from a different email than the invite was sent to", async () => {
    const invitee = await createUser();
    const stranger = await createUser();
    const invite = await createInvite(wsA.workspaceId, ownerA.id, {
      email: invitee.email,
      role: "member",
    });
    await expect(
      acceptInvite(invite.token, { id: stranger.id, email: stranger.email }),
    ).rejects.toMatchObject({ code: "invite_email_mismatch" });
    expect(await isMember(wsA.workspaceId, stranger.id)).toBe(false);
  });

  it("rejects an expired invite", async () => {
    const invitee = await createUser();
    const invite = await createInvite(wsA.workspaceId, ownerA.id, {
      email: invitee.email,
      role: "member",
    });
    // Force expiry.
    await controlDb
      .update(inviteTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(inviteTokens.id, invite.id));

    expect((await getInviteByToken(invite.token)).status).toBe("expired");
    await expect(
      acceptInvite(invite.token, { id: invitee.id, email: invitee.email }),
    ).rejects.toMatchObject({ code: "invite_expired" });
  });

  it("rejects creating an invite for someone already a member", async () => {
    const user = await createUser();
    await addMemberByEmail(wsA.workspaceId, { email: user.email, role: "member" });
    await expect(
      createInvite(wsA.workspaceId, ownerA.id, { email: user.email, role: "member" }),
    ).rejects.toMatchObject({ code: "already_a_member" });
  });
});

describe("membership mutations are admin-gated", () => {
  it("requireWorkspaceRole('admin') blocks a member", () => {
    const req = { workspace: { id: "w", slug: "w", role: "member" } } as unknown as Request;
    let error: unknown;
    requireWorkspaceRole("admin")(req, {} as Response, (e?: unknown) => {
      error = e;
    });
    expect((error as AppError).code).toBe("insufficient_workspace_role");
  });
});

describe("owner protection", () => {
  it("blocks changing, removing, or leaving as the workspace owner", async () => {
    await expect(changeMemberRole(wsA.workspaceId, ownerA.id, "member")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(removeMember(wsA.workspaceId, ownerA.id)).rejects.toMatchObject({
      code: "cannot_modify_owner",
    });
    await expect(leaveWorkspace(wsA.workspaceId, ownerA.id)).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe("removal & leave revoke channel access (and stay tenant-isolated)", () => {
  it("removing a member strips their channel_members rows in that workspace only", async () => {
    const user = await createUser();
    // Member of BOTH workspaces, in a channel in each.
    await addMemberByEmail(wsA.workspaceId, { email: user.email, role: "member" });
    await addMemberByEmail(wsB.workspaceId, { email: user.email, role: "member" });
    const chanA = await makeChannel(wsA.workspaceId, ownerA.id, "public", "a-room");
    const chanB = await makeChannel(wsB.workspaceId, ownerB.id, "public", "b-room");
    await joinChannel(wsA.workspaceId, user.id, chanA.id);
    await joinChannel(wsB.workspaceId, user.id, chanB.id);
    expect(await channelMemberCount(wsA, user.id)).toBe(1);
    expect(await channelMemberCount(wsB, user.id)).toBe(1);

    await removeMember(wsA.workspaceId, user.id);

    // Gone from wsA entirely…
    expect(await isMember(wsA.workspaceId, user.id)).toBe(false);
    expect(await channelMemberCount(wsA, user.id)).toBe(0);
    // …but wsB is untouched (no cross-tenant bleed).
    expect(await isMember(wsB.workspaceId, user.id)).toBe(true);
    expect(await channelMemberCount(wsB, user.id)).toBe(1);
  });

  it("leaving revokes channel access in that workspace", async () => {
    const user = await createUser();
    await addMemberByEmail(wsA.workspaceId, { email: user.email, role: "member" });
    const chan = await makeChannel(wsA.workspaceId, ownerA.id, "public", "leave-room");
    await joinChannel(wsA.workspaceId, user.id, chan.id);
    expect(await channelMemberCount(wsA, user.id)).toBe(1);

    await leaveWorkspace(wsA.workspaceId, user.id);
    expect(await isMember(wsA.workspaceId, user.id)).toBe(false);
    expect(await channelMemberCount(wsA, user.id)).toBe(0);
  });
});
