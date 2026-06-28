import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "../../src/infrastructure/database/pool.js";
import { backplane } from "../../src/infrastructure/realtime/backplane.js";
import { hub } from "../../src/infrastructure/realtime/hub.js";
import { joinChannel } from "../../src/modules/channels/channels.service.js";
import { openOrCreateDm } from "../../src/modules/channels/dm.service.js";
import { sendMessage } from "../../src/modules/channels/messages.service.js";
import {
  getSummary,
  listNotifications,
  markAllSeen,
  markRead,
  setNotificationEnabled,
} from "../../src/modules/notifications/notifications.service.js";
import {
  addMember,
  createUser,
  createWorkspace,
  destroyWorkspace,
  makeChannel,
  type TestUser,
  type TestWorkspace,
} from "../factories.js";

/**
 * The awareness fan-out + notification inbox. EVERY message bumps unread for
 * other members and persists a notification (`'message'` for channels, `'dm'`
 * for direct messages) — unless the recipient has disabled the workspace, in
 * which case unread still bumps but no notification is created. The summary
 * aggregates unread + notifications, and seen/read toggle the right state.
 */

let owner: TestUser;
let bob: TestUser;
let ws: TestWorkspace;

beforeAll(async () => {
  owner = await createUser();
  bob = await createUser();
  ws = await createWorkspace(owner.id);
  await addMember(ws.workspaceId, bob.id, "member");
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  if (ws) await destroyWorkspace(ws);
  await backplane.close();
  await pool.end();
});

/** Kinds of events delivered to `bob` across all `publishToUsers` batch calls. */
const bobKinds = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls
    .flatMap((c) => c[0] as Array<{ userId: string; event: { kind: string } }>)
    .filter((e) => e.userId === bob.id)
    .map((e) => e.event.kind);

describe("awareness fan-out", () => {
  it("a channel message bumps unread AND persists a 'message' notification", async () => {
    const channel = await makeChannel(ws.workspaceId, owner.id, "public", "general");
    await joinChannel(ws.workspaceId, bob.id, channel.id);

    const spy = vi.spyOn(hub, "publishToUsers").mockResolvedValue();
    await sendMessage(ws.workspaceId, channel.id, owner.id, {
      clientId: randomUUID(),
      body: "hello channel",
    });

    const kinds = bobKinds(spy);
    expect(kinds).toContain("unread.bump");
    expect(kinds).toContain("notification.created");
    // The author isn't notified about their own message.
    const recipients = spy.mock.calls.flatMap((c) =>
      (c[0] as Array<{ userId: string }>).map((e) => e.userId),
    );
    expect(recipients).not.toContain(owner.id);

    const n = (await listNotifications(bob.id, { limit: 50 })).find(
      (x) => x.channelId === channel.id,
    );
    expect(n).toMatchObject({ type: "message", channelName: "general", actorId: owner.id });
  });

  it("a DM bumps unread AND persists a 'dm' notification (no channel name)", async () => {
    const dm = await openOrCreateDm(ws.workspaceId, owner.id, [bob.id]);

    const spy = vi.spyOn(hub, "publishToUsers").mockResolvedValue();
    await sendMessage(ws.workspaceId, dm.id, owner.id, { clientId: randomUUID(), body: "hey bob" });

    const kinds = bobKinds(spy);
    expect(kinds).toContain("unread.bump");
    expect(kinds).toContain("notification.created");

    const n = (await listNotifications(bob.id, { limit: 50 })).find((x) => x.channelId === dm.id);
    expect(n).toMatchObject({ type: "dm", channelName: null, actorId: owner.id });
  });

  it("a disabled workspace still bumps unread but creates no notification", async () => {
    await setNotificationEnabled(bob.id, ws.workspaceId, false);
    const channel = await makeChannel(ws.workspaceId, owner.id, "public", "muted-room");
    await joinChannel(ws.workspaceId, bob.id, channel.id);

    const spy = vi.spyOn(hub, "publishToUsers").mockResolvedValue();
    await sendMessage(ws.workspaceId, channel.id, owner.id, {
      clientId: randomUUID(),
      body: "you won't be pinged",
    });

    const kinds = bobKinds(spy);
    expect(kinds).toContain("unread.bump");
    expect(kinds).not.toContain("notification.created");

    const n = (await listNotifications(bob.id, { limit: 50 })).find(
      (x) => x.channelId === channel.id,
    );
    expect(n).toBeUndefined();

    await setNotificationEnabled(bob.id, ws.workspaceId, true); // restore
  });
});

describe("notification summary + read state", () => {
  it("aggregates unread + notification counts, then clears on seen/read", async () => {
    // Fresh users/workspace so the counts are deterministic.
    const o = await createUser();
    const b = await createUser();
    const w = await createWorkspace(o.id);
    await addMember(w.workspaceId, b.id, "member");
    try {
      const dm = await openOrCreateDm(w.workspaceId, o.id, [b.id]);
      await sendMessage(w.workspaceId, dm.id, o.id, { clientId: randomUUID(), body: "hi" });

      const before = await getSummary(b.id);
      const row = before.workspaces.find((x) => x.workspaceId === w.workspaceId)!;
      expect(row.unread).toBeGreaterThan(0);
      expect(row.notifications).toBe(1);
      expect(before.unseen).toBe(1);

      expect(await markAllSeen(b.id)).toBe(1);
      expect((await getSummary(b.id)).unseen).toBe(0);

      const inbox = await listNotifications(b.id, { limit: 10 });
      expect(await markRead(b.id, { channelId: inbox[0]!.channelId })).toBe(1);
      const after = await getSummary(b.id);
      expect(after.workspaces.find((x) => x.workspaceId === w.workspaceId)!.notifications).toBe(0);
    } finally {
      await destroyWorkspace(w);
    }
  });
});
