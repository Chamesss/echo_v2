import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { controlDb } from "../../src/infrastructure/database/control/client.js";
import { memberships, notifications } from "../../src/infrastructure/database/control/schema.js";
import { pool } from "../../src/infrastructure/database/pool.js";
import { backplane } from "../../src/infrastructure/realtime/backplane.js";
import { hub } from "../../src/infrastructure/realtime/hub.js";
import {
  addChannelMember,
  deleteChannel,
  joinChannel,
  leaveChannel,
  removeChannelMember,
  updateChannel,
} from "../../src/modules/channels/channels.service.js";
import { openOrCreateDm } from "../../src/modules/channels/dm.service.js";
import {
  drainAwarenessFanOut,
  markRead as markCursorRead,
  sendMessage,
} from "../../src/modules/channels/messages.service.js";
import { removeMember } from "../../src/modules/members/members.service.js";
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

/**
 * Send, then wait for the awareness fan-out.
 *
 * `sendMessage` no longer awaits the fan-out — it's best-effort work that used to
 * sit inside the caller's wait for no correctness gain. So every assertion about
 * notifications has to drain it first, or it races the write it's checking.
 */
async function send(workspaceId: string, channelId: string, authorId: string, body: string) {
  const message = await sendMessage(workspaceId, channelId, authorId, {
    clientId: randomUUID(),
    body,
  });
  await drainAwarenessFanOut();
  return message;
}

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
    await send(ws.workspaceId, channel.id, owner.id, "hello channel");

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
    await send(ws.workspaceId, dm.id, owner.id, "hey bob");

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
    await send(ws.workspaceId, channel.id, owner.id, "you won't be pinged");

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

describe("how a conversation names itself in the inbox", () => {
  /** The `channelName` snapshot on `who`'s notification for a message in `channelId`. */
  const labelFor = async (who: string, channelId: string) =>
    (await listNotifications(who, { limit: 50 })).find((n) => n.channelId === channelId)
      ?.channelName;

  it("labels an unnamed group by the OTHER people in it", async () => {
    // Before this, an unnamed group sent `null` and read "sent you a message" —
    // byte-identical to a private 1:1. You couldn't tell whether someone had
    // written to you alone or in front of everyone else.
    const carol = await createUser();
    await addMember(ws.workspaceId, carol.id, "member");
    const group = await openOrCreateDm(ws.workspaceId, owner.id, [bob.id, carol.id]);

    await send(ws.workspaceId, group.id, owner.id, "hello group");

    // Per recipient: each reader sees the others, never their own name.
    const forBob = await labelFor(bob.id, group.id);
    expect(forBob).toBeTruthy();
    expect(forBob).toContain(owner.name);
    expect(forBob).toContain(carol.name);
    expect(forBob).not.toContain(bob.name);

    const forCarol = await labelFor(carol.id, group.id);
    expect(forCarol).toContain(bob.name);
    expect(forCarol).not.toContain(carol.name);
  });

  it("prefers a group's own name once it has one", async () => {
    const carol = await createUser();
    await addMember(ws.workspaceId, carol.id, "member");
    const group = await openOrCreateDm(ws.workspaceId, owner.id, [bob.id, carol.id]);
    await updateChannel(ws.workspaceId, group.id, { userId: owner.id, isWorkspaceAdmin: false }, {
      name: "Project X",
    });

    await send(ws.workspaceId, group.id, owner.id, "named now");

    expect(await labelFor(bob.id, group.id)).toBe("Project X");
  });

  it("still sends nothing for a 1:1", async () => {
    // The sender IS the conversation, so a label would only repeat them.
    const solo = await createUser();
    await addMember(ws.workspaceId, solo.id, "member");
    const dm = await openOrCreateDm(ws.workspaceId, owner.id, [solo.id]);

    await send(ws.workspaceId, dm.id, owner.id, "just us");

    expect(await labelFor(solo.id, dm.id)).toBeNull();
  });
});

describe("notifications don't outlive access", () => {
  /** How many inbox entries `who` holds for `channelId`, as the app would see them. */
  const countFor = async (who: string, channelId: string) =>
    (await listNotifications(who, { limit: 50 })).filter((n) => n.channelId === channelId).length;

  /**
   * Rows physically present for `who` in `workspaceId`, bypassing every read
   * filter — the only way to tell "deleted" from "hidden by the membership join".
   */
  const rowsInTable = async (who: string, workspaceId: string) =>
    (
      await controlDb
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(eq(notifications.userId, who), eq(notifications.workspaceId, workspaceId)),
        )
    ).length;

  it("drops the removed member's entries, and only theirs", async () => {
    const carol = await createUser();
    await addMember(ws.workspaceId, carol.id, "member");
    const group = await openOrCreateDm(ws.workspaceId, owner.id, [bob.id, carol.id]);
    await send(ws.workspaceId, group.id, owner.id, "before the removal");

    expect(await countFor(bob.id, group.id)).toBeGreaterThan(0);
    expect(await countFor(carol.id, group.id)).toBeGreaterThan(0);

    // `owner` created the group, so they're its only authority to evict.
    await removeChannelMember(
      ws.workspaceId,
      group.id,
      { userId: owner.id, isWorkspaceAdmin: false },
      bob.id,
    );

    expect(await countFor(bob.id, group.id)).toBe(0);
    // Everyone still in the conversation keeps theirs.
    expect(await countFor(carol.id, group.id)).toBeGreaterThan(0);
  });

  it("drops your own when you leave", async () => {
    const carol = await createUser();
    await addMember(ws.workspaceId, carol.id, "member");
    const group = await openOrCreateDm(ws.workspaceId, owner.id, [bob.id, carol.id]);
    await send(ws.workspaceId, group.id, owner.id, "you'll leave this");
    expect(await countFor(carol.id, group.id)).toBeGreaterThan(0);

    await leaveChannel(ws.workspaceId, carol.id, group.id);

    expect(await countFor(carol.id, group.id)).toBe(0);
  });

  it("drops everyone's when the channel is deleted", async () => {
    // The tenant rows cascade; these live in the control plane with no FK to
    // them, so nothing else would ever collect them.
    const channel = await makeChannel(ws.workspaceId, owner.id, "private", `doomed-${Date.now()}`);
    await addChannelMember(ws.workspaceId, channel.id, owner.id, bob.id);
    await send(ws.workspaceId, channel.id, owner.id, "this channel is going away");
    expect(await countFor(bob.id, channel.id)).toBeGreaterThan(0);

    await deleteChannel(ws.workspaceId, channel.id, { userId: owner.id, isWorkspaceAdmin: true });

    expect(await countFor(bob.id, channel.id)).toBe(0);
  });

  it("drops a departing member's entries for that workspace only", async () => {
    const o = await createUser();
    const leaver = await createUser();
    const w1 = await createWorkspace(o.id);
    const w2 = await createWorkspace(o.id);
    try {
      await addMember(w1.workspaceId, leaver.id, "member");
      await addMember(w2.workspaceId, leaver.id, "member");
      const dm1 = await openOrCreateDm(w1.workspaceId, o.id, [leaver.id]);
      const dm2 = await openOrCreateDm(w2.workspaceId, o.id, [leaver.id]);
      await send(w1.workspaceId, dm1.id, o.id, "in workspace one");
      await send(w2.workspaceId, dm2.id, o.id, "in workspace two");

      await removeMember(w1.workspaceId, leaver.id);

      // Straight to the table, NOT through `listNotifications`: the
      // membership-scoped read would hide these rows either way, so querying it
      // couldn't tell a real delete from one that never ran. Rows that are merely
      // invisible still accumulate forever.
      expect(await rowsInTable(leaver.id, w1.workspaceId)).toBe(0);
      // The other workspace is untouched — removal is scoped, not global.
      expect(await rowsInTable(leaver.id, w2.workspaceId)).toBeGreaterThan(0);
      expect(await countFor(leaver.id, dm2.id)).toBeGreaterThan(0);
    } finally {
      await destroyWorkspace(w1);
      await destroyWorkspace(w2);
    }
  });

  it("hides entries for a workspace you no longer belong to, even without cleanup", async () => {
    // The BACKSTOP, proved independently of the deletes above: rows can survive a
    // failed cleanup, and the table already holds historical ones. Deleting the
    // membership directly simulates exactly that.
    const o = await createUser();
    const gone = await createUser();
    const w = await createWorkspace(o.id);
    try {
      await addMember(w.workspaceId, gone.id, "member");
      const dm = await openOrCreateDm(w.workspaceId, o.id, [gone.id]);
      await send(w.workspaceId, dm.id, o.id, "you'll lose access to this");

      const before = await getSummary(gone.id);
      expect(before.unseen).toBeGreaterThan(0);

      // Straight to the table — no service call, so no cleanup runs.
      await controlDb
        .delete(memberships)
        .where(
          and(eq(memberships.workspaceId, w.workspaceId), eq(memberships.userId, gone.id)),
        );

      expect(await countFor(gone.id, dm.id)).toBe(0);
      expect((await getSummary(gone.id)).unseen).toBe(0);
    } finally {
      await destroyWorkspace(w);
    }
  });
});

describe("reading a conversation clears its notifications", () => {
  it("marks them read when the message cursor advances", async () => {
    // These are two records of one fact. The client used to clear notifications
    // once per channel OPEN while the cursor kept advancing on every focus, so
    // anything arriving after that first moment stayed unread in the bell —
    // and a reload brought the count back. One signal now drives both.
    const o = await createUser();
    const reader = await createUser();
    const w = await createWorkspace(o.id);
    try {
      await addMember(w.workspaceId, reader.id, "member");
      const dm = await openOrCreateDm(w.workspaceId, o.id, [reader.id]);
      const message = await send(w.workspaceId, dm.id, o.id, "read me");

      const unread = (await listNotifications(reader.id, { limit: 50 })).filter(
        (n) => n.channelId === dm.id && n.readAt === null,
      );
      expect(unread).toHaveLength(1);

      await markCursorRead(w.workspaceId, dm.id, reader.id, message.seq);

      const after = (await listNotifications(reader.id, { limit: 50 })).filter(
        (n) => n.channelId === dm.id,
      );
      expect(after).toHaveLength(1);
      expect(after[0]!.readAt).not.toBeNull();
    } finally {
      await destroyWorkspace(w);
    }
  });
});

describe("paging the inbox", () => {
  it("walks the whole list once, with no gaps or repeats — even across a tied timestamp", async () => {
    // Rows are inserted directly so two can be given the SAME `created_at`. That
    // tie is the entire reason the cursor is `(created_at, id)`: on `created_at`
    // alone, equal keys sort arbitrarily between queries, so a page boundary
    // landing on them can drop a row from the sequence or serve it twice.
    const o = await createUser();
    const reader = await createUser();
    const w = await createWorkspace(o.id);
    try {
      await addMember(w.workspaceId, reader.id, "member");
      const dm = await openOrCreateDm(w.workspaceId, o.id, [reader.id]);

      const tied = new Date("2030-01-01T00:00:00.000Z");
      await controlDb.insert(notifications).values(
        [
          new Date("2030-01-01T00:00:04.000Z"),
          new Date("2030-01-01T00:00:03.000Z"),
          tied,
          tied,
          new Date("2030-01-01T00:00:01.000Z"),
        ].map((createdAt) => ({
          userId: reader.id,
          workspaceId: w.workspaceId,
          type: "dm",
          actorId: o.id,
          channelId: dm.id,
          messageId: randomUUID(),
          createdAt,
        })),
      );

      const all = await listNotifications(reader.id, { limit: 100 });
      expect(all).toHaveLength(5);

      // Page through two at a time, following the cursor exactly as the client does.
      const walked: string[] = [];
      let cursor: { before: string; beforeId: string } | undefined;
      for (let guard = 0; guard < 10; guard++) {
        const page = await listNotifications(reader.id, { limit: 2, ...cursor });
        walked.push(...page.map((n) => n.id));
        if (page.length < 2) break;
        const tail = page[page.length - 1]!;
        cursor = { before: tail.createdAt, beforeId: tail.id };
      }

      // Same rows, same order, each exactly once.
      expect(walked).toEqual(all.map((n) => n.id));
      expect(new Set(walked).size).toBe(5);
    } finally {
      await destroyWorkspace(w);
    }
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
      await send(w.workspaceId, dm.id, o.id, "hi");

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
