import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../src/infrastructure/database/pool.js";
import { backplane } from "../../src/infrastructure/realtime/backplane.js";
import { getChannelReads, joinChannel } from "../../src/modules/channels/channels.service.js";
import { markRead, sendMessage } from "../../src/modules/channels/messages.service.js";
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
 * Read receipts: every member's `last_read_seq` is exposed via `getChannelReads`
 * (the basis for "seen by"), advances monotonically on `markRead`, and is gated
 * by channel membership.
 */

let owner: TestUser;
let bob: TestUser;
let outsider: TestUser;
let ws: TestWorkspace;

beforeAll(async () => {
  owner = await createUser();
  bob = await createUser();
  outsider = await createUser();
  ws = await createWorkspace(owner.id);
  await addMember(ws.workspaceId, bob.id, "member");
  await addMember(ws.workspaceId, outsider.id, "member"); // workspace member, not channel member
});

afterAll(async () => {
  if (ws) await destroyWorkspace(ws);
  await backplane.close();
  await pool.end();
});

describe("channel read cursors", () => {
  it("reports each member's cursor and advances it monotonically", async () => {
    const channel = await makeChannel(ws.workspaceId, owner.id, "public", "room");
    await joinChannel(ws.workspaceId, bob.id, channel.id);

    // Two messages → channel clock at 2.
    await sendMessage(ws.workspaceId, channel.id, owner.id, { clientId: randomUUID(), body: "one" });
    await sendMessage(ws.workspaceId, channel.id, owner.id, { clientId: randomUUID(), body: "two" });

    await markRead(ws.workspaceId, channel.id, owner.id, 2);
    await markRead(ws.workspaceId, channel.id, bob.id, 1);

    const reads = await getChannelReads(ws.workspaceId, owner.id, channel.id);
    const byUser = new Map(reads.map((r) => [r.userId, r.lastReadSeq]));
    expect(byUser.get(owner.id)).toBe(2);
    expect(byUser.get(bob.id)).toBe(1);

    // Monotonic: a lower seq never moves the cursor backwards.
    await markRead(ws.workspaceId, channel.id, bob.id, 1);
    const after = await getChannelReads(ws.workspaceId, owner.id, channel.id);
    expect(after.find((r) => r.userId === bob.id)!.lastReadSeq).toBe(1);
  });

  it("denies a non-member reading the cursors", async () => {
    const channel = await makeChannel(ws.workspaceId, owner.id, "private", "secret");
    await expect(getChannelReads(ws.workspaceId, outsider.id, channel.id)).rejects.toThrow();
  });
});
