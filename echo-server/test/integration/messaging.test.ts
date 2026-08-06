import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantSchema } from "../../src/infrastructure/database/tenant/client.js";
import {
  deleteMessage,
  editMessage,
  listMessages,
  sendMessage,
} from "../../src/modules/channels/messages.service.js";
import {
  createUser,
  createWorkspace,
  makeChannel,
  type TestWorkspace,
} from "../factories.js";
import { teardown } from "../helpers/teardown.js";

/**
 * The messaging engine is the heart of the "never trust the room" design: the
 * per-channel sequence in Postgres is the source of truth. These integration
 * tests run against a real database and lock the four guarantees clients rely on
 * to self-heal — gapless ordering, idempotency, edit history, and catch-up.
 */

let ws: TestWorkspace;
let userId: string;

beforeAll(async () => {
  const user = await createUser();
  userId = user.id;
  ws = await createWorkspace(userId);
});

afterAll(() => teardown(ws));

/** A fresh channel so each test's sequence starts at 1, independent of others. */
async function freshChannel(name: string): Promise<string> {
  const channel = await makeChannel(ws.workspaceId, userId, "public", name);
  return channel.id;
}

/** Read a channel's current change-clock value. */
async function lastSeq(channelId: string): Promise<number> {
  return withTenantSchema(ws.workspaceId, async (db) => {
    const { rows } = await db.query<{ last_seq: number }>(
      "SELECT last_seq FROM channels WHERE id = $1",
      [channelId],
    );
    return rows[0]!.last_seq;
  });
}

describe("messaging engine", () => {
  it("assigns gapless, unique sequences under concurrent sends", async () => {
    const channelId = await freshChannel("race");
    const N = 25;

    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        sendMessage(ws.workspaceId, channelId, userId, {
          clientId: randomUUID(),
          body: `m${i}`,
        }),
      ),
    );

    const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
    // The per-channel row lock serializes writers, so 25 concurrent sends must
    // produce exactly 1..25 — no gaps, no duplicates, no burned sequences.
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    expect(new Set(seqs).size).toBe(N);
    expect(await lastSeq(channelId)).toBe(N);
  });

  it("is idempotent on clientId: a retry returns the same row and burns no sequence", async () => {
    const channelId = await freshChannel("idem");
    const clientId = randomUUID();

    const first = await sendMessage(ws.workspaceId, channelId, userId, { clientId, body: "hello" });
    const retry = await sendMessage(ws.workspaceId, channelId, userId, {
      clientId,
      body: "hello (retried)",
    });

    expect(retry.id).toBe(first.id);
    expect(retry.seq).toBe(first.seq);
    expect(retry.body).toBe("hello"); // original preserved, not overwritten
    expect(await lastSeq(channelId)).toBe(first.seq); // clock not advanced
  });

  it("catch-up (?since) returns creates, edits and deletes in clock order", async () => {
    const channelId = await freshChannel("catchup");

    await sendMessage(ws.workspaceId, channelId, userId, { clientId: randomUUID(), body: "a" });
    await sendMessage(ws.workspaceId, channelId, userId, { clientId: randomUUID(), body: "b" });
    const last = await sendMessage(ws.workspaceId, channelId, userId, {
      clientId: randomUUID(),
      body: "c",
    });

    const fromZero = await listMessages(ws.workspaceId, channelId, userId, { since: 0, limit: 50 });
    expect(fromZero.map((m) => m.body)).toEqual(["a", "b", "c"]);

    // Caller already at the latest clock value sees nothing new.
    const upToDate = await listMessages(ws.workspaceId, channelId, userId, {
      since: last.updatedSeq,
      limit: 50,
    });
    expect(upToDate).toHaveLength(0);
  });

  it("edit bumps the version, snapshots a revision, and advances the clock", async () => {
    const channelId = await freshChannel("edit");
    const msg = await sendMessage(ws.workspaceId, channelId, userId, {
      clientId: randomUUID(),
      body: "v1",
    });

    const edited = await editMessage(ws.workspaceId, channelId, msg.id, userId, { body: "v2" });

    expect(edited.version).toBe(2);
    expect(edited.body).toBe("v2");
    expect(edited.updatedSeq).toBeGreaterThan(msg.seq);

    const revisions = await withTenantSchema(ws.workspaceId, async (db) => {
      const { rows } = await db.query<{ version: number; body: string }>(
        "SELECT version, body FROM message_revisions WHERE message_id = $1 ORDER BY version",
        [msg.id],
      );
      return rows;
    });
    expect(revisions).toEqual([{ version: 1, body: "v1" }]);
  });

  it("soft-deletes: clears the body, advances the clock, hidden from history but visible to catch-up", async () => {
    const channelId = await freshChannel("delete");
    const msg = await sendMessage(ws.workspaceId, channelId, userId, {
      clientId: randomUUID(),
      body: "bye",
    });

    const deleted = await deleteMessage(ws.workspaceId, channelId, msg.id, userId);
    expect(deleted.deleted).toBe(true);
    expect(deleted.body).toBe("");
    expect(deleted.updatedSeq).toBeGreaterThan(msg.seq);

    // History (no `since`) hides deletes…
    const history = await listMessages(ws.workspaceId, channelId, userId, { limit: 50 });
    expect(history.find((m) => m.id === msg.id)).toBeUndefined();

    // …but catch-up surfaces the tombstone so clients can remove it locally.
    const catchUp = await listMessages(ws.workspaceId, channelId, userId, { since: 0, limit: 50 });
    expect(catchUp.find((m) => m.id === msg.id)?.deleted).toBe(true);
  });
});
