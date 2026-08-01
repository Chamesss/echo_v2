import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "../../src/infrastructure/database/pool.js";
import { backplane } from "../../src/infrastructure/realtime/backplane.js";
import { hub } from "../../src/infrastructure/realtime/hub.js";
import * as presence from "../../src/infrastructure/realtime/presence.js";
import { listOnlineMembers } from "../../src/modules/members/presence.service.js";
import { invalidateDirectory } from "../../src/modules/members/directory.service.js";
import {
  addMember,
  createUser,
  createWorkspace,
  destroyWorkspace,
  type TestUser,
  type TestWorkspace,
} from "../factories.js";

/**
 * Presence is derived, not stored: "online" means the hub holds a `/ws/user`
 * socket. These tests drive the two edges the socket layer reports
 * (`hub.addUserSocket` / `removeUserSocket` return values) straight into
 * `presence.ts`, which is where all the judgement lives — who to tell, and
 * whether "offline" is real yet.
 */

let a: TestUser;
let b: TestUser;
let ws: TestWorkspace;
let other: TestWorkspace;

beforeAll(async () => {
  a = await createUser();
  b = await createUser();
  ws = await createWorkspace(a.id);
  await addMember(ws.workspaceId, b.id, "member");
  // A second workspace that `a` belongs to and `b` does not — proves the
  // fan-out is scoped to the user's own memberships.
  other = await createWorkspace(a.id);
});

afterAll(async () => {
  if (ws) await destroyWorkspace(ws);
  if (other) await destroyWorkspace(other);
  await backplane.close();
  await pool.end();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("presence announcements", () => {
  it("announces online to every workspace the user belongs to, and only those", async () => {
    const publish = vi.spyOn(hub, "publishToWorkspaces").mockResolvedValue();

    presence.onUserConnected(a.id, true);
    // `announce` is fire-and-forget (`void`), so let its promise settle.
    await vi.waitFor(() => expect(publish).toHaveBeenCalled());

    const [workspaceIds, event] = publish.mock.calls[0]!;
    expect(event).toEqual({ kind: "presence.changed", userId: a.id, online: true });
    expect([...workspaceIds].sort()).toEqual([ws.workspaceId, other.workspaceId].sort());
  });

  it("stays silent when another tab is still open", async () => {
    const publish = vi.spyOn(hub, "publishToWorkspaces").mockResolvedValue();

    // wasFirst=false → a second tab, nothing changed for anyone watching.
    presence.onUserConnected(b.id, false);
    // wasLast=false → one of several tabs closed; they're still here.
    presence.onUserDisconnected(b.id, false);

    expect(publish).not.toHaveBeenCalled();
  });

  it("holds the offline edge, then announces it once the grace window passes", async () => {
    vi.useFakeTimers();
    const publish = vi.spyOn(hub, "publishToWorkspaces").mockResolvedValue();

    presence.onUserDisconnected(b.id, true);
    // Nothing yet: a refresh looks exactly like this for the first few seconds.
    expect(publish).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000); // fires the grace timer
    // `announce` then awaits a REAL membership query, which fake time can't
    // advance — hand back to the real clock so it can finish.
    vi.useRealTimers();
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));

    const [, event] = publish.mock.calls[0]!;
    expect(event).toEqual({ kind: "presence.changed", userId: b.id, online: false });
  });

  it("says NOTHING at all when a refresh reconnects inside the grace window", async () => {
    // The case the grace window exists for. A refresh is close→open in about a
    // second; announcing offline then online would flicker every avatar in the
    // workspace. Neither frame should be sent — the clients were never wrong.
    vi.useFakeTimers();
    const publish = vi.spyOn(hub, "publishToWorkspaces").mockResolvedValue();

    presence.onUserDisconnected(b.id, true);
    await vi.advanceTimersByTimeAsync(1_000);
    presence.onUserConnected(b.id, true); // the entry was gone, so wasFirst is true
    await vi.advanceTimersByTimeAsync(30_000); // well past the grace window

    // Real time, so that if the timer HAD survived, its pending membership
    // query would land here and fail the assertion rather than hiding behind
    // the fake clock.
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 300));
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("presence snapshot", () => {
  it("returns only workspace members, never the whole hub", async () => {
    // A user in NO shared workspace must not leak through the process-wide
    // socket registry.
    const stranger = await createUser();
    vi.spyOn(hub, "onlineUserIds").mockReturnValue([a.id, b.id, stranger.id]);
    invalidateDirectory(ws.workspaceId);

    const online = await listOnlineMembers(ws.workspaceId);

    expect(online.sort()).toEqual([a.id, b.id].sort());
    expect(online).not.toContain(stranger.id);
  });

  it("is empty when nobody is connected", async () => {
    vi.spyOn(hub, "onlineUserIds").mockReturnValue([]);
    invalidateDirectory(ws.workspaceId);

    expect(await listOnlineMembers(ws.workspaceId)).toEqual([]);
  });
});
