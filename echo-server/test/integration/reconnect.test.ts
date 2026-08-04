import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../src/infrastructure/database/pool.js";
import { backplane } from "../../src/infrastructure/realtime/backplane.js";
import { getChannelReads } from "../../src/modules/channels/channels.service.js";
import { openOrCreateDm } from "../../src/modules/channels/dm.service.js";
import {
  deleteMessage,
  editMessage,
  listMessages,
  markRead,
  sendMessage,
} from "../../src/modules/channels/messages.service.js";
import {
  addMember,
  createUser,
  createWorkspace,
  destroyWorkspace,
  type TestUser,
  type TestWorkspace,
} from "../factories.js";

/**
 * The catch-up contract — what a client relies on to converge after any outage.
 *
 * `connection-loss.test.ts` proves the socket recovers; this proves that what it
 * recovers TO is correct. Everything here is expressed against the same REST
 * query the client's `runCatchUp` issues (`?since=<clock>`), because that query
 * is the only thing standing between "we missed some frames" and "the timeline
 * is wrong". The socket is an accelerator; these are the guarantees underneath.
 */

let author: TestUser;
let reader: TestUser;
let ws: TestWorkspace;
let channelId: string;

beforeAll(async () => {
  author = await createUser();
  reader = await createUser();
  ws = await createWorkspace(author.id);
  await addMember(ws.workspaceId, reader.id, "member");
  channelId = (await openOrCreateDm(ws.workspaceId, author.id, [reader.id])).id;
});

afterAll(async () => {
  if (ws) await destroyWorkspace(ws);
  await backplane.close();
  await pool.end();
});

const send = (body: string) =>
  sendMessage(ws.workspaceId, channelId, author.id, { clientId: randomUUID(), body });

/** Exactly what the client asks for on reconnect. */
const catchUp = (since: number, limit = 100) =>
  listMessages(ws.workspaceId, channelId, reader.id, { since, limit });

describe("catch-up after an outage", () => {
  it("returns everything missed since the client's clock", async () => {
    const before = await send("before the outage");
    const missed = await Promise.all([send("m1"), send("m2"), send("m3")]);

    // The client resumes from the last clock value it applied.
    const recovered = await catchUp(before.updatedSeq);
    const seqs = recovered.map((m) => m.seq);

    for (const m of missed) expect(seqs).toContain(m.seq);
    expect(seqs).not.toContain(before.seq); // strictly newer than the cursor
  });

  it("returns rows in clock order, so the timeline can't be assembled wrong", async () => {
    const start = (await send("ordering anchor")).updatedSeq;
    await Promise.all([send("o1"), send("o2"), send("o3"), send("o4")]);

    const recovered = await catchUp(start);
    const clocks = recovered.map((m) => m.updatedSeq);

    expect(clocks).toEqual([...clocks].sort((a, b) => a - b));
  });

  it("never returns the same message twice in one pass", async () => {
    const start = (await send("dedupe anchor")).updatedSeq;
    await Promise.all(Array.from({ length: 8 }, (_, i) => send(`d${i}`)));

    const recovered = await catchUp(start);
    const ids = recovered.map((m) => m.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is idempotent — replaying the same cursor yields the same rows", async () => {
    // A client may re-run catch-up (reconnect, then a gap, then another
    // reconnect). Repeating it must converge, not accumulate.
    const start = (await send("idempotency anchor")).updatedSeq;
    await Promise.all([send("i1"), send("i2")]);

    const first = await catchUp(start);
    const second = await catchUp(start);

    expect(second.map((m) => m.id)).toEqual(first.map((m) => m.id));
  });

  it("carries edits and deletes, not just new messages", async () => {
    // Catch-up keys on `updated_seq`, not `seq` — so a message that was edited
    // or deleted while the client was away still comes back. Keying on `seq`
    // would leave the client showing stale text, or a message that no longer
    // exists, with nothing to correct it.
    const target = await send("original text");
    const doomed = await send("will be deleted");
    const clock = doomed.updatedSeq;

    await editMessage(ws.workspaceId, channelId, target.id, author.id, {
      body: "edited text",
    });
    await deleteMessage(ws.workspaceId, channelId, doomed.id, author.id);

    const recovered = await catchUp(clock);
    const edited = recovered.find((m) => m.id === target.id);
    const removed = recovered.find((m) => m.id === doomed.id);

    expect(edited?.body).toBe("edited text");
    expect(removed?.deleted).toBe(true);
  });

  it("pages through a backlog larger than one request", async () => {
    // The client loops until a short page proves it is current. A backlog that
    // exceeds the limit must not silently truncate.
    const start = (await send("paging anchor")).updatedSeq;
    await Promise.all(Array.from({ length: 12 }, (_, i) => send(`p${i}`)));

    let cursor = start;
    const collected: number[] = [];
    for (let pass = 0; pass < 10; pass += 1) {
      const page = await catchUp(cursor, 5);
      if (page.length === 0) break;
      collected.push(...page.map((m) => m.seq));
      cursor = page.reduce((max, m) => Math.max(max, m.updatedSeq), cursor);
      if (page.length < 5) break;
    }

    expect(collected.length).toBeGreaterThanOrEqual(12);
    expect(new Set(collected).size).toBe(collected.length); // no overlap between pages
  });
});

describe("read receipts across an outage", () => {
  it("are readable after the fact, since the live event can't be replayed", async () => {
    // `channel.read` carries no `updatedSeq`, so it rides outside the catch-up
    // sequence entirely — a receipt that lands while a client is disconnected
    // is simply gone from the socket's point of view. The only way back is to
    // re-read the cursors, which is what the client now does on reconnect.
    const newest = await send("read me");
    await markRead(ws.workspaceId, channelId, reader.id, newest.seq);

    const reads = await getChannelReads(ws.workspaceId, author.id, channelId);
    const cursor = reads.find((r) => r.userId === reader.id)?.lastReadSeq ?? 0;

    expect(cursor).toBeGreaterThanOrEqual(newest.seq);
  });

  it("never move backwards when marks arrive out of order", async () => {
    const newest = await send("cursor anchor");
    await markRead(ws.workspaceId, channelId, reader.id, newest.seq);

    // A late, lower mark from before the outage must not un-see anything.
    await markRead(ws.workspaceId, channelId, reader.id, 1);

    const reads = await getChannelReads(ws.workspaceId, author.id, channelId);
    const cursor = reads.find((r) => r.userId === reader.id)!.lastReadSeq;
    expect(cursor).toBeGreaterThanOrEqual(newest.seq);
  });
});

describe("send idempotency under retry", () => {
  it("collapses a replayed clientId to one message", async () => {
    const clientId = randomUUID();
    const first = await sendMessage(ws.workspaceId, channelId, author.id, {
      clientId,
      body: "retry me",
    });
    const replay = await sendMessage(ws.workspaceId, channelId, author.id, {
      clientId,
      body: "retry me",
    });

    expect(replay.id).toBe(first.id);
    expect(replay.seq).toBe(first.seq);
  });

  it("burns no sequence number on the replay", async () => {
    // If a retry consumed a seq, every flaky connection would punch a permanent
    // hole in the channel clock — and a hole is indistinguishable from a lost
    // message, so clients would catch up forever.
    const clientId = randomUUID();
    await sendMessage(ws.workspaceId, channelId, author.id, { clientId, body: "no burn" });
    const afterFirst = await send("marker a");

    await sendMessage(ws.workspaceId, channelId, author.id, { clientId, body: "no burn" });
    const afterReplay = await send("marker b");

    expect(afterReplay.seq).toBe(afterFirst.seq + 1);
  });

  it("keeps the sequence gapless across a burst of mixed new and replayed sends", async () => {
    const replayed = randomUUID();
    await sendMessage(ws.workspaceId, channelId, author.id, {
      clientId: replayed,
      body: "seed",
    });
    const start = (await send("burst anchor")).seq;

    await Promise.all([
      send("n1"),
      sendMessage(ws.workspaceId, channelId, author.id, { clientId: replayed, body: "seed" }),
      send("n2"),
      sendMessage(ws.workspaceId, channelId, author.id, { clientId: replayed, body: "seed" }),
      send("n3"),
    ]);

    const after = await catchUp(start, 200);
    const seqs = after.map((m) => m.seq).sort((a, b) => a - b);
    // Three genuinely new messages, contiguous from the anchor — the replays
    // added nothing and skipped nothing.
    expect(seqs).toEqual([start + 1, start + 2, start + 3]);
  });
});
