import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deleteChannel,
  updateChannel,
} from "../../src/modules/channels/channels.service.js";
import { listDirectMessages, openOrCreateDm } from "../../src/modules/channels/dm.service.js";
import {
  addMember,
  createUser,
  createWorkspace,
  makeChannel,
  type TestUser,
  type TestWorkspace,
} from "../factories.js";
import { teardown } from "../helpers/teardown.js";
import { addChannelMember, leaveChannel, removeChannelMember } from "../../src/modules/channels/channels.members.js";

/**
 * The rules that separate a conversation from a channel.
 *
 * These two had been travelling the same code path: `:channelId` routes with a
 * single "workspace admin OR creator" check that never looked at `type`. That
 * conflation is what allowed an admin to delete a DM they couldn't read, and
 * what let a third person be added to a 1:1 while its `dm_key` still named only
 * two — so the next "message Bob" silently reopened the room with the extra
 * person in it.
 *
 * The model asserted here:
 *   - a 1:1 is FIXED — no renaming, no archiving, no membership changes at all;
 *   - a group belongs to its members — they rename it and bring people in, its
 *     creator evicts, anyone may leave, and nobody may delete or archive it;
 *   - a workspace role grants none of the above on either.
 */

let owner: TestUser; // workspace admin, deliberately NOT in the conversations
let a: TestUser;
let b: TestUser;
let c: TestUser;
let outsider: TestUser;
let ws: TestWorkspace;

const adminActor = () => ({ userId: owner.id, isWorkspaceAdmin: true });
const actor = (u: TestUser) => ({ userId: u.id, isWorkspaceAdmin: false });

/**
 * Shared, never-mutated fixtures for the rejection cases.
 *
 * Every assertion below that expects a throw leaves the conversation untouched
 * by definition, so they can share one group and one 1:1. Only the tests that
 * actually change something create their own — this database round-trips slowly
 * enough that a fresh conversation per test measurably lengthens the whole suite.
 */
let sharedGroup: Awaited<ReturnType<typeof openOrCreateDm>>;
let sharedDirect: Awaited<ReturnType<typeof openOrCreateDm>>;

beforeAll(async () => {
  owner = await createUser();
  ws = await createWorkspace(owner.id);
  a = await createUser();
  b = await createUser();
  c = await createUser();
  outsider = await createUser();
  for (const u of [a, b, c, outsider]) await addMember(ws.workspaceId, u.id, "member");

  sharedGroup = await openOrCreateDm(ws.workspaceId, a.id, [b.id, c.id]);
  sharedDirect = await openOrCreateDm(ws.workspaceId, a.id, [b.id]);
});

afterAll(() => teardown(ws));

const newGroup = () => openOrCreateDm(ws.workspaceId, a.id, [b.id, c.id]);

describe("a 1:1 is fixed for life", () => {
  it("refuses a third participant", async () => {
    // The privacy rule. Adding here would leave `dm_key` naming two of three.
    await expect(
      addChannelMember(ws.workspaceId, sharedDirect.id, a.id, c.id),
    ).rejects.toMatchObject({ code: "direct_message_is_fixed" });
  });

  it("leaves the original untouched when a group is started instead", async () => {
    const group = await openOrCreateDm(ws.workspaceId, a.id, [b.id, c.id]);

    expect(group.id).not.toBe(sharedDirect.id);
    // The 1:1 still resolves to itself, still with exactly two people.
    const reopened = await openOrCreateDm(ws.workspaceId, a.id, [b.id]);
    expect(reopened.id).toBe(sharedDirect.id);
    expect(reopened.participants).toHaveLength(2);
  });

  it("refuses to remove a participant", async () => {
    await expect(
      removeChannelMember(ws.workspaceId, sharedDirect.id, actor(a), b.id),
    ).rejects.toMatchObject({ code: "not_allowed_on_conversation" });
  });

  it("can't be left", async () => {
    // There is no "close/hide" concept to fall back on, so leaving would strand
    // the other person in a conversation whose key still names you.
    await expect(leaveChannel(ws.workspaceId, a.id, sharedDirect.id)).rejects.toMatchObject({
      code: "not_allowed_on_conversation",
    });
  });

  it("can't be renamed or archived", async () => {
    await expect(
      updateChannel(ws.workspaceId, sharedDirect.id, actor(a), { name: "nope" }),
    ).rejects.toMatchObject({ code: "not_allowed_on_conversation" });
  });
});

describe("a group belongs to its members", () => {
  it("can be renamed by any member, and the name survives a re-read", async () => {
    // `buildDmDTO` used to overwrite `name` with a participant label on every
    // read, making a rename a write that persisted and then vanished.
    const g = await newGroup();
    await updateChannel(ws.workspaceId, g.id, actor(b), { name: "Project X" });

    const listed = (await listDirectMessages(ws.workspaceId, b.id)).find((d) => d.id === g.id);
    expect(listed?.name).toBe("Project X");
    expect(listed?.customName).toBe("Project X");
  });

  it("falls back to the participant label when the name is cleared", async () => {
    const g = await newGroup();
    await updateChannel(ws.workspaceId, g.id, actor(a), { name: "Temporary" });
    await updateChannel(ws.workspaceId, g.id, actor(a), { name: null });

    const listed = (await listDirectMessages(ws.workspaceId, a.id)).find((d) => d.id === g.id);
    expect(listed?.customName).toBeNull();
    expect(listed?.name).toContain(b.name);
  });

  it("accepts new people from any member", async () => {
    const g = await newGroup();
    await addChannelMember(ws.workspaceId, g.id, b.id, outsider.id);

    const listed = (await listDirectMessages(ws.workspaceId, outsider.id)).find(
      (d) => d.id === g.id,
    );
    expect(listed).toBeDefined();
    expect(listed!.participants).toHaveLength(4);
  });

  it("lets its creator remove someone", async () => {
    const g = await newGroup(); // created by `a`
    await removeChannelMember(ws.workspaceId, g.id, actor(a), c.id);

    const forC = (await listDirectMessages(ws.workspaceId, c.id)).find((d) => d.id === g.id);
    expect(forC).toBeUndefined();
  });

  it("stops a non-creator from evicting someone else", async () => {
    // No per-channel roles exist, so `created_by` is the only authority a group
    // has — otherwise any member could clear the room.
    await expect(
      removeChannelMember(ws.workspaceId, sharedGroup.id, actor(b), c.id),
    ).rejects.toMatchObject({ code: "cannot_manage_channel" });
  });

  it("lets anyone remove themselves", async () => {
    const g = await newGroup();
    await removeChannelMember(ws.workspaceId, g.id, actor(b), b.id);

    const forB = (await listDirectMessages(ws.workspaceId, b.id)).find((d) => d.id === g.id);
    expect(forB).toBeUndefined();
  });

  it("can be left", async () => {
    const g = await newGroup();
    await leaveChannel(ws.workspaceId, c.id, g.id);

    expect((await listDirectMessages(ws.workspaceId, c.id)).find((d) => d.id === g.id)).toBeUndefined();
    // ...and it survives for everyone else.
    expect((await listDirectMessages(ws.workspaceId, a.id)).find((d) => d.id === g.id)).toBeDefined();
  });

  it("shuts out someone who isn't in it", async () => {
    await expect(
      updateChannel(ws.workspaceId, sharedGroup.id, actor(outsider), { name: "hijacked" }),
    ).rejects.toMatchObject({ code: "not_a_channel_member" });
  });

  it("can't be archived — leaving is the exit", async () => {
    // Archiving drops a conversation out of BOTH list endpoints while leaving
    // it readable by id, with no UI to bring it back.
    await expect(
      updateChannel(ws.workspaceId, sharedGroup.id, actor(a), { archived: true }),
    ).rejects.toMatchObject({ code: "not_allowed_on_conversation" });
  });
});

describe("a workspace admin has no power over a conversation", () => {
  it("can't delete a 1:1 they aren't in", async () => {
    // Reading was already blocked; destroying was not. An admin could wipe a
    // conversation and every message in it without ever being able to see it.
    await expect(
      deleteChannel(ws.workspaceId, sharedDirect.id, adminActor()),
    ).rejects.toMatchObject({ code: "not_allowed_on_conversation" });
  });

  it("can't delete a group they aren't in", async () => {
    await expect(
      deleteChannel(ws.workspaceId, sharedGroup.id, adminActor()),
    ).rejects.toMatchObject({ code: "not_allowed_on_conversation" });
  });

  it("can't rename or archive one", async () => {
    await expect(
      updateChannel(ws.workspaceId, sharedGroup.id, adminActor(), { name: "admin says so" }),
    ).rejects.toMatchObject({ code: "not_a_channel_member" });
  });

  it("can't add or remove participants", async () => {
    await expect(
      removeChannelMember(ws.workspaceId, sharedGroup.id, adminActor(), b.id),
    ).rejects.toMatchObject({ code: "not_a_channel_member" });
  });

  it("still fully manages a real channel", async () => {
    // The rule is about conversations, not about admins — a named channel is an
    // organisational object and admins own it whether or not they joined.
    const ch = await makeChannel(ws.workspaceId, a.id, "public", `ops-${Date.now()}`);
    const renamed = await updateChannel(ws.workspaceId, ch.id, adminActor(), { name: "renamed" });
    expect(renamed.name).toBe("renamed");
    await expect(deleteChannel(ws.workspaceId, ch.id, adminActor())).resolves.toBeUndefined();
  });

  it("can't leave a channel's name empty", async () => {
    // `name: null` clears a group's label; a channel has nothing to fall back to.
    const ch = await makeChannel(ws.workspaceId, a.id, "public", `keep-${Date.now()}`);
    await expect(
      updateChannel(ws.workspaceId, ch.id, adminActor(), { name: null }),
    ).rejects.toMatchObject({ code: "bad_request" });
  });
});
