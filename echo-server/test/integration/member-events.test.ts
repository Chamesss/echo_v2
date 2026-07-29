import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "../../src/infrastructure/database/pool.js";
import { backplane } from "../../src/infrastructure/realtime/backplane.js";
import { hub } from "../../src/infrastructure/realtime/hub.js";
import {
  addMemberByEmail,
  changeMemberRole,
  leaveWorkspace,
  removeMember,
} from "../../src/modules/members/members.service.js";
import {
  addMember,
  createUser,
  createWorkspace,
  destroyWorkspace,
  type TestUser,
  type TestWorkspace,
} from "../factories.js";

/**
 * Roster mutations must announce themselves on the realtime bus so live clients
 * update without a reload. We spy on `hub.publish` (deterministic, no NOTIFY
 * timing) and assert each member operation emits the right workspace event.
 */

let owner: TestUser;
let bob: TestUser;
let ws: TestWorkspace;

beforeAll(async () => {
  owner = await createUser();
  bob = await createUser();
  ws = await createWorkspace(owner.id);
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  if (ws) await destroyWorkspace(ws);
  await backplane.close();
  await pool.end();
});

describe("member events on the realtime bus", () => {
  it("publishes member.added when an admin adds a member by email", async () => {
    const publish = vi.spyOn(hub, "publish").mockResolvedValue();
    await addMemberByEmail(ws.workspaceId, { email: bob.email, role: "member" });
    expect(publish).toHaveBeenCalledWith(ws.workspaceId, {
      kind: "member.added",
      userId: bob.id,
      role: "member",
    });
  });

  it("publishes member.role_changed when a member's role changes", async () => {
    const publish = vi.spyOn(hub, "publish").mockResolvedValue();
    await changeMemberRole(ws.workspaceId, bob.id, "admin");
    expect(publish).toHaveBeenCalledWith(ws.workspaceId, {
      kind: "member.role_changed",
      userId: bob.id,
      role: "admin",
    });
  });

  it("publishes member.removed when a member is removed", async () => {
    const publish = vi.spyOn(hub, "publish").mockResolvedValue();
    await removeMember(ws.workspaceId, bob.id);
    expect(publish).toHaveBeenCalledWith(ws.workspaceId, {
      kind: "member.removed",
      userId: bob.id,
    });
  });

  it("publishes member.removed when a member leaves", async () => {
    await addMember(ws.workspaceId, bob.id, "member");
    const publish = vi.spyOn(hub, "publish").mockResolvedValue();
    await leaveWorkspace(ws.workspaceId, bob.id);
    expect(publish).toHaveBeenCalledWith(ws.workspaceId, {
      kind: "member.removed",
      userId: bob.id,
    });
  });
});
