import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "../../src/infrastructure/database/pool.js";
import { backplane } from "../../src/infrastructure/realtime/backplane.js";
import { hub } from "../../src/infrastructure/realtime/hub.js";
import {
  assertChannelAccess,
  getChannel,
  listChannels,
} from "../../src/modules/channels/channels.service.js";
import { listDirectMessages, openOrCreateDm } from "../../src/modules/channels/dm.service.js";
import { listMessages, sendMessage } from "../../src/modules/channels/messages.service.js";
import {
  addMember,
  createUser,
  createWorkspace,
  destroyWorkspace,
  type TestUser,
  type TestWorkspace,
} from "../factories.js";

let a: TestUser;
let b: TestUser;
let c: TestUser; // workspace member, but NOT in the A↔B DM
let ws: TestWorkspace;

beforeAll(async () => {
  a = await createUser();
  b = await createUser();
  c = await createUser();
  ws = await createWorkspace(a.id);
  await addMember(ws.workspaceId, b.id, "member");
  await addMember(ws.workspaceId, c.id, "member");
});

afterAll(async () => {
  if (ws) await destroyWorkspace(ws);
  await backplane.close();
  await pool.end();
});

afterEach(() => vi.restoreAllMocks());

describe("dm.created events on the realtime bus", () => {
  it("dual-routes dm.created to the OTHER participants on a brand-new DM only", async () => {
    const d = await createUser();
    await addMember(ws.workspaceId, d.id, "member");

    const toUsers = vi.spyOn(hub, "publishToUsers").mockResolvedValue();
    const dm = await openOrCreateDm(ws.workspaceId, a.id, [d.id]);

    // The creator (a) is NOT notified; the other participant (d) is.
    expect(toUsers).toHaveBeenCalledWith([
      { userId: d.id, event: { kind: "dm.created", workspaceId: ws.workspaceId, channelId: dm.id } },
    ]);

    // Re-opening the same DM is idempotent → no second notification.
    toUsers.mockClear();
    await openOrCreateDm(ws.workspaceId, a.id, [d.id]);
    expect(toUsers).not.toHaveBeenCalled();
  });

  it("re-emits dm.created on the DM's FIRST message so a missed one still lands", async () => {
    // The open-or-create emit above is single-shot and fires when the sender
    // picks the person — possibly long before they type, and NOTIFY is
    // at-most-once. Riding the message too puts discovery on the durable path.
    const e = await createUser();
    await addMember(ws.workspaceId, e.id, "member");
    const dm = await openOrCreateDm(ws.workspaceId, a.id, [e.id]);

    const toUsers = vi.spyOn(hub, "publishToUsers").mockResolvedValue();
    await sendMessage(ws.workspaceId, dm.id, a.id, { clientId: randomUUID(), body: "first" });

    const first = toUsers.mock.calls.at(-1)![0];
    expect(first).toContainEqual({
      userId: e.id,
      event: { kind: "dm.created", workspaceId: ws.workspaceId, channelId: dm.id },
    });
    // The author is never told about their own conversation.
    expect(first.filter((x) => x.userId === a.id)).toEqual([]);

    // Every later message is an unread bump only — no repeat.
    toUsers.mockClear();
    await sendMessage(ws.workspaceId, dm.id, a.id, { clientId: randomUUID(), body: "second" });
    const later = toUsers.mock.calls.at(-1)![0];
    expect(later.some((x) => x.event.kind === "dm.created")).toBe(false);
    expect(later.some((x) => x.event.kind === "unread.bump")).toBe(true);
  });
});

describe("open-or-create (idempotent)", () => {
  it("resolves the same 1:1 channel regardless of who opens it", async () => {
    const dm1 = await openOrCreateDm(ws.workspaceId, a.id, [b.id]);
    expect(dm1.type).toBe("direct");
    expect(dm1.participants.map((p) => p.userId).sort()).toEqual([a.id, b.id].sort());
    expect(dm1.name).toBe(b.name); // labelled with the other person

    const again = await openOrCreateDm(ws.workspaceId, a.id, [b.id]);
    expect(again.id).toBe(dm1.id);

    const fromB = await openOrCreateDm(ws.workspaceId, b.id, [a.id]);
    expect(fromB.id).toBe(dm1.id); // canonical dm_key → same channel
  });

  it("resolves the same group channel for the same participant set", async () => {
    const g1 = await openOrCreateDm(ws.workspaceId, a.id, [b.id, c.id]);
    expect(g1.type).toBe("group");
    expect(g1.participants.map((p) => p.userId).sort()).toEqual([a.id, b.id, c.id].sort());

    const g2 = await openOrCreateDm(ws.workspaceId, c.id, [a.id, b.id]);
    expect(g2.id).toBe(g1.id);
  });

  it("rejects participants who aren't workspace members", async () => {
    const outsider = await createUser();
    await expect(openOrCreateDm(ws.workspaceId, a.id, [outsider.id])).rejects.toMatchObject({
      code: "not_a_member",
    });
  });
});

describe("participants-only access", () => {
  it("denies a non-participant over REST and the WS subscribe path", async () => {
    const dm = await openOrCreateDm(ws.workspaceId, a.id, [b.id]);
    await expect(getChannel(ws.workspaceId, c.id, dm.id)).rejects.toMatchObject({
      code: "not_a_channel_member",
    });
    await expect(assertChannelAccess(ws.workspaceId, c.id, dm.id)).rejects.toMatchObject({
      code: "not_a_channel_member",
    });
    // A participant can read it.
    await expect(getChannel(ws.workspaceId, b.id, dm.id)).resolves.toMatchObject({ isMember: true });
  });
});

describe("messaging on a DM", () => {
  it("reuses the engine: send + catch-up work; non-participants can't post", async () => {
    const dm = await openOrCreateDm(ws.workspaceId, a.id, [b.id]);
    const sent = await sendMessage(ws.workspaceId, dm.id, a.id, {
      clientId: randomUUID(),
      body: "hi B",
    });
    expect(sent.seq).toBeGreaterThan(0);

    const catchUp = await listMessages(ws.workspaceId, dm.id, b.id, { since: 0, limit: 50 });
    expect(catchUp.map((m) => m.body)).toContain("hi B");

    await expect(
      sendMessage(ws.workspaceId, dm.id, c.id, { clientId: randomUUID(), body: "intruder" }),
    ).rejects.toMatchObject({ code: "not_a_channel_member" });
  });
});

describe("listing", () => {
  it("keeps DMs out of the channel list and in the DM list", async () => {
    const dm = await openOrCreateDm(ws.workspaceId, a.id, [b.id]);
    expect((await listChannels(ws.workspaceId, a.id)).map((ch) => ch.id)).not.toContain(dm.id);
    expect((await listDirectMessages(ws.workspaceId, a.id)).map((d) => d.id)).toContain(dm.id);
  });

  it("orders by last activity, not by message count", async () => {
    const x = await createUser();
    const y = await createUser();
    await addMember(ws.workspaceId, x.id, "member");
    await addMember(ws.workspaceId, y.id, "member");
    const order = async (): Promise<string[]> =>
      (await listDirectMessages(ws.workspaceId, x.id)).map((d) => d.id);

    // `chatty` piles up messages, then goes idle; `quiet` is opened afterwards.
    const chatty = await openOrCreateDm(ws.workspaceId, x.id, [a.id]);
    for (const body of ["1", "2", "3"]) {
      await sendMessage(ws.workspaceId, chatty.id, x.id, { clientId: randomUUID(), body });
    }
    const quiet = await openOrCreateDm(ws.workspaceId, x.id, [y.id]);

    // Empty and brand-new, `quiet` still outranks the busier-but-idle thread.
    // Ordering by `last_seq` (a change COUNTER) buried it at the bottom, which
    // is where a just-created DM used to land in the recipient's sidebar.
    let ids = await order();
    expect(ids.indexOf(quiet.id)).toBeLessThan(ids.indexOf(chatty.id));

    await sendMessage(ws.workspaceId, quiet.id, x.id, { clientId: randomUUID(), body: "hey" });
    ids = await order();
    expect(ids.indexOf(quiet.id)).toBeLessThan(ids.indexOf(chatty.id));

    // …and one new message revives the older thread to the top.
    await sendMessage(ws.workspaceId, chatty.id, x.id, { clientId: randomUUID(), body: "4" });
    ids = await order();
    expect(ids.indexOf(chatty.id)).toBeLessThan(ids.indexOf(quiet.id));
  });
});
