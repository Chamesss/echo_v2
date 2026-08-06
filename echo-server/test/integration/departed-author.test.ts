import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { joinChannel } from "../../src/modules/channels/channels.service.js";
import { listMessages, sendMessage } from "../../src/modules/channels/messages.service.js";
import { addMemberByEmail, removeMember } from "../../src/modules/members/members.service.js";
import {
  addMember,
  createUser,
  createWorkspace,
  makeChannel,
  type TestUser,
  type TestWorkspace,
} from "../factories.js";
import { teardown } from "../helpers/teardown.js";

/**
 * Departed-member message handling: a message whose author has left the
 * workspace is withheld (body blanked + authorActive=false) for everyone else,
 * reversibly — rejoining the workspace makes it readable again. Resolved at
 * read time by joining author → current membership.
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

afterAll(() => teardown(ws));

describe("departed-author message hiding", () => {
  it("withholds a departed member's messages, then restores them on rejoin", async () => {
    const channel = await makeChannel(ws.workspaceId, owner.id, "public", "room");
    await joinChannel(ws.workspaceId, bob.id, channel.id);
    const sent = await sendMessage(ws.workspaceId, channel.id, bob.id, {
      clientId: randomUUID(),
      body: "secret from bob",
    });

    const find = async (opts: { since?: number; limit: number }) => {
      const list = await listMessages(ws.workspaceId, channel.id, owner.id, opts);
      return list.find((m) => m.id === sent.id);
    };

    // While Bob is a member: visible to the owner, with an author snapshot
    // (name) so the client paints without waiting on the directory.
    let msg = await find({ limit: 50 });
    expect(msg?.body).toBe("secret from bob");
    expect(msg?.authorActive).toBe(true);
    expect(msg?.authorName).toBe(bob.name);

    // Bob leaves the workspace → body AND identity snapshot withheld on both
    // history and catch-up reads (a "Former member" row leaks no name/avatar).
    await removeMember(ws.workspaceId, bob.id);

    msg = await find({ limit: 50 });
    expect(msg?.body).toBe("");
    expect(msg?.authorActive).toBe(false);
    expect(msg?.authorName).toBeUndefined();
    expect(msg?.authorImage).toBeNull();

    const viaCatchUp = (await listMessages(ws.workspaceId, channel.id, owner.id, {
      since: 0,
      limit: 50,
    })).find((m) => m.id === sent.id);
    expect(viaCatchUp?.body).toBe("");
    expect(viaCatchUp?.authorActive).toBe(false);

    // Bob rejoins the workspace → message + identity snapshot readable again.
    await addMemberByEmail(ws.workspaceId, { email: bob.email, role: "member" });
    msg = await find({ limit: 50 });
    expect(msg?.body).toBe("secret from bob");
    expect(msg?.authorActive).toBe(true);
    expect(msg?.authorName).toBe(bob.name);
  });
});
