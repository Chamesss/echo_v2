import type { Request, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { controlDb } from "../../src/infrastructure/database/control/client.js";
import { authEvents } from "../../src/infrastructure/database/control/schema.js";
import { WorkspaceEventName } from "../../src/infrastructure/audit/audit-log.js";
import { loadWorkspace } from "../../src/shared/middleware/load-workspace.js";
import { requireWorkspaceRole } from "../../src/shared/middleware/require-workspace-role.js";
import { createChannelController } from "../../src/modules/channels/channels.controller.js";
import { AppError, ForbiddenError } from "../../src/shared/errors/app-error.js";
import {
  addMember,
  createUser,
  createWorkspace,
  type TestUser,
  type TestWorkspace,
} from "../factories.js";
import { teardown } from "../helpers/teardown.js";

/**
 * The authorization layer: workspace membership + role enforcement and the
 * admin-action audit trail. These run against a real control DB so the
 * cross-tenant denial (the heart of multi-tenant isolation) is proven, not
 * mocked.
 */

let userA: TestUser; // owner/admin of wsA
let userB: TestUser; // owner/admin of wsB, also a plain member of wsA
let wsA: TestWorkspace;
let wsB: TestWorkspace;

beforeAll(async () => {
  userA = await createUser();
  userB = await createUser();
  wsA = await createWorkspace(userA.id);
  wsB = await createWorkspace(userB.id);
  await addMember(wsA.workspaceId, userB.id, "member");
});

afterAll(() => teardown(wsA, wsB));

/**
 * Drive `loadWorkspace` directly. The `await` is load-bearing despite the types:
 * `RequestHandler` returns `void`, but the implementation is async and calls
 * `next` after a query.
 */
async function runLoadWorkspace(userId: string, workspaceId: string) {
  const req = { params: { workspaceId }, user: { id: userId } } as unknown as Request;
  let error: unknown;
  // `RequestHandler` erases the returned promise, so the rule can't see it.
  // eslint-disable-next-line @typescript-eslint/await-thenable
  await loadWorkspace(req, {} as Response, (e?: unknown) => {
    error = e;
  });
  return { req, error };
}

/** Drive a `requireWorkspaceRole(...)` guard with a synthesized workspace context. */
function runRoleGuard(role: "admin" | "member" | undefined, allowed: ("admin" | "member")[]) {
  const req = {
    workspace: role ? { id: "w", slug: "w", role } : undefined,
  } as unknown as Request;
  let error: unknown;
  requireWorkspaceRole(...allowed)(req, {} as Response, (e?: unknown) => {
    error = e;
  });
  return error;
}

describe("loadWorkspace (membership + role resolution)", () => {
  it("resolves the owner as an admin member", async () => {
    const { req, error } = await runLoadWorkspace(userA.id, wsA.workspaceId);
    expect(error).toBeUndefined();
    expect(req.workspace?.role).toBe("admin");
  });

  it("resolves an added user as a plain member", async () => {
    const { req, error } = await runLoadWorkspace(userB.id, wsA.workspaceId);
    expect(error).toBeUndefined();
    expect(req.workspace?.role).toBe("member");
  });

  it("denies a non-member across tenants (no leakage between workspaces)", async () => {
    // userA owns wsA but is NOT a member of wsB.
    const { req, error } = await runLoadWorkspace(userA.id, wsB.workspaceId);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as AppError).code).toBe("not_a_member");
    expect(req.workspace).toBeUndefined();
  });
});

describe("requireWorkspaceRole", () => {
  it("lets an admin through an admin-only guard", () => {
    expect(runRoleGuard("admin", ["admin"])).toBeUndefined();
  });

  it("blocks a member from an admin-only guard with 403 + stable code", () => {
    const error = runRoleGuard("member", ["admin"]);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as AppError).statusCode).toBe(403);
    expect((error as AppError).code).toBe("insufficient_workspace_role");
  });

  it("fails closed when the workspace context is missing", () => {
    expect(runRoleGuard(undefined, ["admin"])).toBeInstanceOf(ForbiddenError);
  });
});

describe("admin-action audit trail", () => {
  it("writes a channel.created audit row scoped to the workspace", async () => {
    const req = {
      user: { id: userA.id },
      workspace: { id: wsA.workspaceId, slug: wsA.slug, role: "admin" },
      body: { type: "public", name: "audit-me" },
      ip: "127.0.0.1",
      get: () => "vitest-agent",
      params: {},
    } as unknown as Request;

    let statusCode = 0;
    let jsonBody: { id?: string } = {};
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(b: unknown) {
        jsonBody = b as { id?: string };
        return this;
      },
    } as unknown as Response;

    await createChannelController(req, res);

    expect(statusCode).toBe(201);
    expect(jsonBody.id).toBeTruthy();

    const rows = await controlDb
      .select({ userId: authEvents.userId, metadata: authEvents.metadata })
      .from(authEvents)
      .where(
        and(
          eq(authEvents.event, WorkspaceEventName.ChannelCreated),
          sql`${authEvents.metadata} ->> 'channelId' = ${jsonBody.id}`,
        ),
      );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userA.id);
    expect((rows[0]!.metadata as { workspaceId: string }).workspaceId).toBe(wsA.workspaceId);
  });
});
