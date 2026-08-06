import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../src/infrastructure/database/pool.js";
import { controlDb } from "../../src/infrastructure/database/control/client.js";
import {
  memberships,
  tenantCatalog,
  workspaces,
} from "../../src/infrastructure/database/control/schema.js";
import { deleteWorkspace, renameWorkspace } from "../../src/modules/workspaces/workspaces.service.js";
import { deleteWorkspaceController } from "../../src/modules/workspaces/workspaces.controller.js";
import { addMemberByEmail } from "../../src/modules/members/members.service.js";
import { getDirectory, invalidateDirectory } from "../../src/modules/members/directory.service.js";
import { ForbiddenError } from "../../src/shared/errors/app-error.js";
import {
  createUser,
  createWorkspace,
  makeChannel,
  type TestUser,
  type TestWorkspace,
} from "../factories.js";
import { teardown } from "../helpers/teardown.js";

let owner: TestUser;
let ws: TestWorkspace; // used by rename + directory tests
const toCleanup: TestWorkspace[] = [];

beforeAll(async () => {
  owner = await createUser();
  ws = await createWorkspace(owner.id);
  toCleanup.push(ws);
});

afterAll(() => teardown(...toCleanup));

async function schemaExists(schemaName: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    "SELECT 1 FROM information_schema.schemata WHERE schema_name = $1",
    [schemaName],
  );
  return (rowCount ?? 0) > 0;
}

describe("workspace rename", () => {
  it("updates the display name (slug stays put)", async () => {
    const updated = await renameWorkspace(ws.workspaceId, "Acme Inc.");
    expect(updated.name).toBe("Acme Inc.");
    expect(updated.slug).toBe(ws.slug);

    const [row] = await controlDb
      .select({ name: workspaces.name, slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, ws.workspaceId));
    expect(row).toEqual({ name: "Acme Inc.", slug: ws.slug });
  });
});

describe("workspace delete + tenant teardown", () => {
  it("drops the tenant schema and cascades all control rows", async () => {
    const o = await createUser();
    const doomed = await createWorkspace(o.id);
    await makeChannel(doomed.workspaceId, o.id, "public", "temp"); // data in the tenant schema
    expect(await schemaExists(doomed.schemaName)).toBe(true);

    await deleteWorkspace(doomed.workspaceId);

    // Tenant schema is gone…
    expect(await schemaExists(doomed.schemaName)).toBe(false);
    // …and the control rows cascaded away (workspace, catalog, memberships).
    expect(
      await controlDb.select().from(workspaces).where(eq(workspaces.id, doomed.workspaceId)),
    ).toHaveLength(0);
    expect(
      await controlDb
        .select()
        .from(tenantCatalog)
        .where(eq(tenantCatalog.workspaceId, doomed.workspaceId)),
    ).toHaveLength(0);
    expect(
      await controlDb
        .select()
        .from(memberships)
        .where(eq(memberships.workspaceId, doomed.workspaceId)),
    ).toHaveLength(0);
  });

  it("blocks a non-owner admin from deleting (owner-only)", async () => {
    const req = {
      user: { id: "some-admin" },
      workspace: { id: ws.workspaceId, slug: ws.slug, name: "x", role: "admin", isOwner: false },
      ip: "127.0.0.1",
      get: () => "vitest",
      params: {},
    } as unknown as Request;
    const res = { status: () => res, end: () => res, json: () => res } as unknown as Response;

    await expect(deleteWorkspaceController(req, res)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteWorkspaceController(req, res)).rejects.toMatchObject({
      code: "not_workspace_owner",
    });
    // The workspace must still exist — the guard fired before any deletion.
    expect(
      await controlDb.select().from(workspaces).where(eq(workspaces.id, ws.workspaceId)),
    ).toHaveLength(1);
  });
});

describe("member directory", () => {
  it("resolves current members, caches, and refreshes on invalidation", async () => {
    const o = await createUser();
    const dirWs = await createWorkspace(o.id);
    toCleanup.push(dirWs);

    const d1 = await getDirectory(dirWs.workspaceId);
    expect(d1[o.id]?.name).toBe(o.name);

    // Insert a membership directly, bypassing the invalidation path…
    const u2 = await createUser();
    await controlDb
      .insert(memberships)
      .values({ userId: u2.id, workspaceId: dirWs.workspaceId, role: "member" });
    // …so the cached directory still doesn't see them.
    const d2 = await getDirectory(dirWs.workspaceId);
    expect(d2[u2.id]).toBeUndefined();

    // After explicit invalidation it does.
    invalidateDirectory(dirWs.workspaceId);
    const d3 = await getDirectory(dirWs.workspaceId);
    expect(d3[u2.id]?.name).toBe(u2.name);

    // And the real membership path invalidates automatically.
    const u3 = await createUser();
    await addMemberByEmail(dirWs.workspaceId, { email: u3.email, role: "member" });
    const d4 = await getDirectory(dirWs.workspaceId);
    expect(d4[u3.id]?.name).toBe(u3.name);
  });
});
