import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../src/infrastructure/database/pool.js";
import { backplane } from "../../src/infrastructure/realtime/backplane.js";
import { getChannelReads } from "../../src/modules/channels/channels.service.js";
import { openOrCreateDm } from "../../src/modules/channels/dm.service.js";
import { listMessages, markRead, sendMessage } from "../../src/modules/channels/messages.service.js";
import {
  addMember,
  createUser,
  createWorkspace,
  destroyWorkspace,
  type TestUser,
  type TestWorkspace,
} from "../factories.js";

/**
 * Ten messages inside a second — the stress case that surfaced a lost "Seen by".
 *
 * The client-side hole turned out to be in the catch-up coalescing, but the
 * server has to be ruled out too: everything downstream (gap detection, read
 * cursors, receipts) assumes the sequence is GAPLESS and that the read cursor
 * only ever moves forward. Both are claims about behaviour under concurrency,
 * so they're worth asserting under concurrency rather than in single file.
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

describe("a burst of concurrent sends", () => {
  it("assigns a gapless sequence even when every send races", async () => {
    // Fired together, not awaited in turn: the row lock in `sendMessage` is what
    // has to serialize them. A duplicate or a hole here would make the client's
    // gap detection fire forever (or never).
    const sent = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        sendMessage(ws.workspaceId, channelId, author.id, {
          clientId: randomUUID(),
          body: `burst ${i}`,
        }),
      ),
    );

    const seqs = sent.map((m) => m.seq).sort((x, y) => x - y);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(seqs).size).toBe(10); // no seq handed out twice

    const history = await listMessages(ws.workspaceId, channelId, reader.id, {
      since: 0,
      limit: 50,
    });
    expect(history).toHaveLength(10);
  });

  it("keeps the read cursor monotonic when marks arrive out of order", async () => {
    // The client marks read on every timeline change, so a burst puts ~10 marks
    // in flight at once and they can land in any order. A late, lower mark must
    // not drag the cursor back — that's what would silently un-see a message.
    await Promise.all(
      [7, 3, 10, 1, 9, 5].map((seq) => markRead(ws.workspaceId, channelId, reader.id, seq)),
    );

    const reads = await getChannelReads(ws.workspaceId, reader.id, channelId);
    const cursor = reads.find((r) => r.userId === reader.id)!.lastReadSeq;
    expect(cursor).toBeGreaterThanOrEqual(10);
  });

  it("reports the reader as having seen the newest message", async () => {
    // The end-to-end claim behind "Seen by": once the reader marks the newest
    // seq, their cursor covers it, which is exactly what `readersOf` filters on.
    const newest = (
      await listMessages(ws.workspaceId, channelId, reader.id, { since: 0, limit: 50 })
    ).reduce((max, m) => Math.max(max, m.seq), 0);

    await markRead(ws.workspaceId, channelId, reader.id, newest);

    const reads = await getChannelReads(ws.workspaceId, reader.id, channelId);
    const cursor = reads.find((r) => r.userId === reader.id)!.lastReadSeq;
    expect(cursor).toBeGreaterThanOrEqual(newest);
  });
});
