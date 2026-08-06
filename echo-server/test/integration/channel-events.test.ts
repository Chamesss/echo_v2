import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hub } from "../../src/infrastructure/realtime/hub.js";
import {
  createChannel,
  deleteChannel,
  joinChannel,
  updateChannel,
} from "../../src/modules/channels/channels.service.js";
import {
  addMember,
  createUser,
  createWorkspace,
  type TestUser,
  type TestWorkspace,
} from "../factories.js";
import { teardown } from "../helpers/teardown.js";
import type { ChannelActor } from "../../src/modules/channels/channels.gates.js";
import { addChannelMember, leaveChannel, removeChannelMember } from "../../src/modules/channels/channels.members.js";

/**
 * Channel-lifecycle mutations must announce themselves on the realtime bus so
 * live clients show a new channel / reflect a rename / drop a deletion without a
 * reload. We spy on `hub.publish` (deterministic, no NOTIFY timing) and assert
 * each op emits the right workspace event. These events carry only the channel
 * id — the client re-reads the visibility-scoped list — so that's all we assert.
 */

let owner: TestUser;
let bob: TestUser; // a second workspace member, for channel-membership tests
let ws: TestWorkspace;

const actor = (userId: string): ChannelActor => ({ userId, isWorkspaceAdmin: true });

beforeAll(async () => {
  owner = await createUser();
  bob = await createUser();
  ws = await createWorkspace(owner.id);
  await addMember(ws.workspaceId, bob.id, "member");
});

afterEach(() => vi.restoreAllMocks());

afterAll(() => teardown(ws));

describe("channel lifecycle events on the realtime bus", () => {
  it("publishes channel.created when a channel is created", async () => {
    const publish = vi.spyOn(hub, "publish").mockResolvedValue();
    const channel = await createChannel(ws.workspaceId, owner.id, { type: "public", name: "general" });
    expect(publish).toHaveBeenCalledWith(ws.workspaceId, {
      kind: "channel.created",
      channelId: channel.id,
    });
  });

  it("publishes channel.updated when a channel is renamed/archived", async () => {
    const channel = await createChannel(ws.workspaceId, owner.id, { type: "public", name: "rename-me" });
    const publish = vi.spyOn(hub, "publish").mockResolvedValue();
    await updateChannel(ws.workspaceId, channel.id, actor(owner.id), { name: "renamed" });
    expect(publish).toHaveBeenCalledWith(ws.workspaceId, {
      kind: "channel.updated",
      channelId: channel.id,
    });
  });

  it("publishes channel.deleted when a channel is deleted", async () => {
    const channel = await createChannel(ws.workspaceId, owner.id, { type: "public", name: "delete-me" });
    const publish = vi.spyOn(hub, "publish").mockResolvedValue();
    await deleteChannel(ws.workspaceId, channel.id, actor(owner.id));
    expect(publish).toHaveBeenCalledWith(ws.workspaceId, {
      kind: "channel.deleted",
      channelId: channel.id,
    });
  });
});

describe("channel membership events on the realtime bus", () => {
  it("dual-routes channel.added to the target + broadcasts channel.updated", async () => {
    const ch = await createChannel(ws.workspaceId, owner.id, { type: "private", name: "priv-add" });
    const publish = vi.spyOn(hub, "publish").mockResolvedValue();
    const toUsers = vi.spyOn(hub, "publishToUsers").mockResolvedValue();
    await addChannelMember(ws.workspaceId, ch.id, owner.id, bob.id);
    expect(toUsers).toHaveBeenCalledWith([
      { userId: bob.id, event: { kind: "channel.added", workspaceId: ws.workspaceId, channelId: ch.id } },
    ]);
    expect(publish).toHaveBeenCalledWith(ws.workspaceId, { kind: "channel.updated", channelId: ch.id });
  });

  it("dual-routes channel.removed to the target + broadcasts channel.updated", async () => {
    const ch = await createChannel(ws.workspaceId, owner.id, { type: "private", name: "priv-rm" });
    await addChannelMember(ws.workspaceId, ch.id, owner.id, bob.id);
    const publish = vi.spyOn(hub, "publish").mockResolvedValue();
    const toUsers = vi.spyOn(hub, "publishToUsers").mockResolvedValue();
    await removeChannelMember(ws.workspaceId, ch.id, actor(owner.id), bob.id);
    expect(toUsers).toHaveBeenCalledWith([
      { userId: bob.id, event: { kind: "channel.removed", workspaceId: ws.workspaceId, channelId: ch.id } },
    ]);
    expect(publish).toHaveBeenCalledWith(ws.workspaceId, { kind: "channel.updated", channelId: ch.id });
  });

  it("broadcasts channel.updated on public join and on leave", async () => {
    const ch = await createChannel(ws.workspaceId, owner.id, { type: "public", name: "pub-joinleave" });

    let publish = vi.spyOn(hub, "publish").mockResolvedValue();
    await joinChannel(ws.workspaceId, bob.id, ch.id);
    expect(publish).toHaveBeenCalledWith(ws.workspaceId, { kind: "channel.updated", channelId: ch.id });

    vi.restoreAllMocks();
    publish = vi.spyOn(hub, "publish").mockResolvedValue();
    await leaveChannel(ws.workspaceId, bob.id, ch.id);
    expect(publish).toHaveBeenCalledWith(ws.workspaceId, { kind: "channel.updated", channelId: ch.id });
  });
});
