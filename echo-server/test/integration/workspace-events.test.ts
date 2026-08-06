import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hub } from "../../src/infrastructure/realtime/hub.js";
import {
  deleteWorkspace,
  renameWorkspace,
} from "../../src/modules/workspaces/workspaces.service.js";
import {
  addMember,
  createUser,
  createWorkspace,
  type TestUser,
  type TestWorkspace,
} from "../factories.js";
import { teardown } from "../helpers/teardown.js";

/**
 * Workspace-lifecycle mutations must announce themselves so live clients re-read
 * the workspace (rename) or get bounced out (delete). Rename broadcasts over the
 * workspace socket; delete DUAL-ROUTES to every member's always-on user socket
 * (so members on the dashboard / in another workspace react too). We spy on the
 * hub to assert the right transport + payload.
 */

let owner: TestUser;
let ws: TestWorkspace;

beforeAll(async () => {
  owner = await createUser();
  ws = await createWorkspace(owner.id);
});

afterEach(() => vi.restoreAllMocks());

afterAll(() => teardown(ws));

describe("workspace lifecycle events on the realtime bus", () => {
  it("broadcasts workspace.updated when the workspace is renamed", async () => {
    const publish = vi.spyOn(hub, "publish").mockResolvedValue();
    await renameWorkspace(ws.workspaceId, "Renamed Workspace");
    expect(publish).toHaveBeenCalledWith(ws.workspaceId, { kind: "workspace.updated" });
  });

  it("dual-routes workspace.deleted to every member when the workspace is deleted", async () => {
    // A throwaway workspace (deleteWorkspace tears it down, so no afterAll cleanup).
    const victim = await createWorkspace(owner.id);
    const bob = await createUser();
    await addMember(victim.workspaceId, bob.id, "member");

    const publishToUsers = vi.spyOn(hub, "publishToUsers").mockResolvedValue();
    await deleteWorkspace(victim.workspaceId);

    expect(publishToUsers).toHaveBeenCalledTimes(1);
    const entries = publishToUsers.mock.calls[0]![0] as ReadonlyArray<{
      userId: string;
      event: { kind: string; workspaceId: string };
    }>;
    const byUser = new Map(entries.map((e) => [e.userId, e.event]));
    expect(byUser.get(owner.id)).toEqual({
      kind: "workspace.deleted",
      workspaceId: victim.workspaceId,
    });
    expect(byUser.get(bob.id)).toEqual({
      kind: "workspace.deleted",
      workspaceId: victim.workspaceId,
    });
  });
});
