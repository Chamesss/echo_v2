import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../src/infrastructure/database/pool.js";
import { backplane } from "../../src/infrastructure/realtime/backplane.js";
import {
  addChannelMember,
  assertChannelAccess,
  createChannel,
  deleteChannel,
  getChannel,
  joinChannel,
  leaveChannel,
  listChannelMembers,
  listChannels,
  removeChannelMember,
  updateChannel,
  type ChannelActor,
} from "../../src/modules/channels/channels.service.js";
import {
  addMember,
  createUser,
  createWorkspace,
  destroyWorkspace,
  type TestUser,
  type TestWorkspace,
} from "../factories.js";

let owner: TestUser; // workspace admin + creator of the test channels
let member: TestUser; // plain workspace member
let admin: TestUser; // workspace admin, NOT the channel creator
let ws: TestWorkspace;

const actor = (userId: string, isWorkspaceAdmin: boolean): ChannelActor => ({
  userId,
  isWorkspaceAdmin,
});

beforeAll(async () => {
  owner = await createUser();
  member = await createUser();
  admin = await createUser();
  ws = await createWorkspace(owner.id);
  await addMember(ws.workspaceId, member.id, "member");
  await addMember(ws.workspaceId, admin.id, "admin");
});

afterAll(async () => {
  if (ws) await destroyWorkspace(ws);
  await backplane.close();
  await pool.end();
});

const ids = (members: { userId: string }[]) => members.map((m) => m.userId);

describe("private channel access", () => {
  it("denies a non-member over both REST and the WS subscribe path", async () => {
    const priv = await createChannel(ws.workspaceId, owner.id, { type: "private", name: "secret" });

    // Creator is a member.
    await expect(getChannel(ws.workspaceId, owner.id, priv.id)).resolves.toMatchObject({
      isMember: true,
    });
    // A workspace member who isn't in the channel is denied both ways.
    await expect(getChannel(ws.workspaceId, member.id, priv.id)).rejects.toMatchObject({
      code: "not_a_channel_member",
    });
    await expect(assertChannelAccess(ws.workspaceId, member.id, priv.id)).rejects.toMatchObject({
      code: "not_a_channel_member",
    });
  });
});

describe("private channel membership management", () => {
  it("adds workspace members, rejects outsiders, and removes (admin/creator)", async () => {
    const priv = await createChannel(ws.workspaceId, owner.id, { type: "private", name: "room" });

    await addChannelMember(ws.workspaceId, priv.id, owner.id, member.id);
    expect(ids(await listChannelMembers(ws.workspaceId, owner.id, priv.id))).toContain(member.id);
    await expect(getChannel(ws.workspaceId, member.id, priv.id)).resolves.toMatchObject({
      isMember: true,
    });

    // Can't add someone who isn't even in the workspace.
    const outsider = await createUser();
    await expect(
      addChannelMember(ws.workspaceId, priv.id, owner.id, outsider.id),
    ).rejects.toMatchObject({ code: "not_a_member" });

    // A plain member can't remove others (not admin, not creator).
    await expect(
      removeChannelMember(ws.workspaceId, priv.id, actor(member.id, false), owner.id),
    ).rejects.toMatchObject({ code: "cannot_manage_channel" });

    // Creator removes the member.
    await removeChannelMember(ws.workspaceId, priv.id, actor(owner.id, true), member.id);
    expect(ids(await listChannelMembers(ws.workspaceId, owner.id, priv.id))).not.toContain(
      member.id,
    );
  });
});

describe("archive", () => {
  it("hides the channel from the list and blocks joining", async () => {
    const pub = await createChannel(ws.workspaceId, owner.id, { type: "public", name: "general-x" });
    expect((await listChannels(ws.workspaceId, owner.id)).map((c) => c.id)).toContain(pub.id);

    const archived = await updateChannel(ws.workspaceId, pub.id, actor(owner.id, true), {
      archived: true,
    });
    expect(archived.archived).toBe(true);

    expect((await listChannels(ws.workspaceId, owner.id)).map((c) => c.id)).not.toContain(pub.id);
    await expect(joinChannel(ws.workspaceId, member.id, pub.id)).rejects.toMatchObject({
      code: "channel_archived",
    });
  });
});

describe("leave channel", () => {
  it("removes the caller's own membership", async () => {
    const pub = await createChannel(ws.workspaceId, owner.id, { type: "public", name: "leaveable" });
    await joinChannel(ws.workspaceId, member.id, pub.id);
    expect(ids(await listChannelMembers(ws.workspaceId, owner.id, pub.id))).toContain(member.id);

    await leaveChannel(ws.workspaceId, member.id, pub.id);
    expect(ids(await listChannelMembers(ws.workspaceId, owner.id, pub.id))).not.toContain(member.id);
  });
});

describe("management authz (admin OR creator)", () => {
  it("allows the creator and any workspace admin, blocks a plain member", async () => {
    const c = await createChannel(ws.workspaceId, owner.id, { type: "public", name: "authz" });

    // Creator can rename.
    await expect(
      updateChannel(ws.workspaceId, c.id, actor(owner.id, true), { name: "renamed" }),
    ).resolves.toMatchObject({ name: "renamed" });

    // A workspace admin who didn't create it can also manage.
    await expect(
      updateChannel(ws.workspaceId, c.id, actor(admin.id, true), { topic: "hello" }),
    ).resolves.toMatchObject({ topic: "hello" });

    // A plain member cannot.
    await expect(
      updateChannel(ws.workspaceId, c.id, actor(member.id, false), { name: "nope" }),
    ).rejects.toMatchObject({ code: "cannot_manage_channel" });
  });

  it("deletes a channel (creator)", async () => {
    const c = await createChannel(ws.workspaceId, owner.id, { type: "public", name: "deleteme" });
    await deleteChannel(ws.workspaceId, c.id, actor(owner.id, true));
    await expect(getChannel(ws.workspaceId, owner.id, c.id)).rejects.toMatchObject({
      code: "channel_not_found",
    });
  });
});
