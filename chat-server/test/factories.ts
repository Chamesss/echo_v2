import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { controlDb } from "../src/infrastructure/database/control/client.js";
import { memberships, users, workspaces } from "../src/infrastructure/database/control/schema.js";
import { pool } from "../src/infrastructure/database/pool.js";
import { clearTenantSchemaCache } from "../src/infrastructure/database/tenant/client.js";
import { provisionWorkspace } from "../src/infrastructure/provisioning/workspace.js";
import { createChannel, type ChannelDTO } from "../src/modules/channels/channels.service.js";

/** A lowercase token for unique slugs/emails. */
function token(): string {
  return randomBytes(6).toString("hex"); // 12 lowercase hex chars
}

export interface TestUser {
  id: string;
  email: string;
  name: string;
}

/** Insert a control-plane user (mirrors what Better Auth would create). */
export async function createUser(overrides: Partial<TestUser> = {}): Promise<TestUser> {
  const id = overrides.id ?? randomUUID();
  const email = overrides.email ?? `u_${token()}@test.local`;
  const name = overrides.name ?? `User ${id.slice(0, 8)}`;
  await controlDb.insert(users).values({ id, email, name });
  return { id, email, name };
}

export interface TestWorkspace {
  workspaceId: string;
  schemaName: string;
  slug: string;
  ownerId: string;
}

/** Provision a workspace + its tenant schema; the owner becomes an admin member. */
export async function createWorkspace(ownerId: string): Promise<TestWorkspace> {
  const slug = `t${token()}`; // starts with a letter, lowercase alnum — matches slug regex
  const { workspaceId, schemaName } = await provisionWorkspace({ slug, ownerId });
  return { workspaceId, schemaName, slug, ownerId };
}

/** Add an existing user to a workspace's control-plane membership. */
export async function addMember(
  workspaceId: string,
  userId: string,
  role: "admin" | "member" = "member",
): Promise<void> {
  await controlDb.insert(memberships).values({ userId, workspaceId, role }).onConflictDoNothing();
}

/** Create a channel via the real service (auto-adds the creator as a member). */
export async function makeChannel(
  workspaceId: string,
  userId: string,
  type: "public" | "private" = "public",
  name = "general",
): Promise<ChannelDTO> {
  return createChannel(workspaceId, userId, { type, name });
}

/** Drop a workspace's tenant schema and its control rows (cascades members + catalog). */
export async function destroyWorkspace(ws: TestWorkspace): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS "${ws.schemaName}" CASCADE`);
  await controlDb.delete(workspaces).where(eq(workspaces.id, ws.workspaceId));
  clearTenantSchemaCache(ws.workspaceId);
}
