import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the S3 layer so nothing touches the real bucket / reads real creds. The
// whole attachments flow (presign + send-time HeadObject verify) goes through
// `s3Service`, so replacing the module exercises our logic deterministically.
const s3mock = vi.hoisted(() => ({
  isConfigured: vi.fn(() => true),
  createPresignedUploadUrl: vi.fn(),
  publicUrlFor: vi.fn((key: string) => `https://bucket.example/${key}`),
  getDownloadUrl: vi.fn(async (key: string) => `https://signed.example/${key}?sig=test`),
  headObject: vi.fn(),
}));
vi.mock("../../src/infrastructure/storage/s3-service.js", () => ({ s3Service: s3mock }));

import { pool } from "../../src/infrastructure/database/pool.js";
import { backplane } from "../../src/infrastructure/realtime/backplane.js";
import { joinChannel, type ChannelDTO } from "../../src/modules/channels/channels.service.js";
import {
  presignAttachment,
  resolveAttachmentsForSend,
} from "../../src/modules/attachments/attachments.service.js";
import {
  editMessage,
  listMessages,
  sendMessage,
} from "../../src/modules/channels/messages.service.js";
import { removeMember } from "../../src/modules/members/members.service.js";
import {
  addMember,
  createUser,
  createWorkspace,
  destroyWorkspace,
  makeChannel,
  type TestUser,
  type TestWorkspace,
} from "../factories.js";

let owner: TestUser;
let outsider: TestUser;
let ws: TestWorkspace;
let channel: ChannelDTO;

beforeAll(async () => {
  owner = await createUser();
  outsider = await createUser();
  ws = await createWorkspace(owner.id);
  channel = await makeChannel(ws.workspaceId, owner.id, "public", "files");
});

afterAll(async () => {
  if (ws) await destroyWorkspace(ws);
  await backplane.close();
  await pool.end();
});

beforeEach(() => {
  s3mock.createPresignedUploadUrl.mockReset();
  s3mock.headObject.mockReset();
  s3mock.createPresignedUploadUrl.mockResolvedValue({
    uploadUrl: "https://put.example",
    publicUrl: "https://bucket.example/k",
    key: "k",
    requiredHeaders: {},
  });
});

/** A valid presigned key for (this workspace, channel, user). */
function keyFor(user: string, ext = "png"): string {
  return `echo/workspaces/${ws.workspaceId}/channels/${channel.id}/${user}/${randomUUID()}.${ext}`;
}

describe("presign", () => {
  it("scopes the key to workspace/channel/user and leaves images inline", async () => {
    await presignAttachment(ws.workspaceId, channel.id, owner.id, {
      filename: "photo.png",
      contentType: "image/png",
      contentLength: 1000,
    });
    const arg = s3mock.createPresignedUploadUrl.mock.calls[0]![0] as {
      key: string;
      contentDisposition?: string;
    };
    expect(arg.key).toMatch(
      new RegExp(`^echo/workspaces/${ws.workspaceId}/channels/${channel.id}/${owner.id}/.+\\.png$`),
    );
    expect(arg.contentDisposition).toBeUndefined(); // images render inline
  });

  it("forces download for unknown/active-content types", async () => {
    await presignAttachment(ws.workspaceId, channel.id, owner.id, {
      filename: "tool.exe",
      contentType: "application/x-msdownload",
      contentLength: 1000,
    });
    const arg = s3mock.createPresignedUploadUrl.mock.calls[0]![0] as { contentDisposition?: string };
    expect(arg.contentDisposition).toContain("attachment");
  });

  it("rejects an over-cap file", async () => {
    await expect(
      presignAttachment(ws.workspaceId, channel.id, owner.id, {
        filename: "huge.png",
        contentType: "image/png",
        contentLength: 999 * 1024 * 1024,
      }),
    ).rejects.toThrow();
  });

  it("denies a non-channel-member", async () => {
    await expect(
      presignAttachment(ws.workspaceId, channel.id, outsider.id, {
        filename: "x.png",
        contentType: "image/png",
        contentLength: 1000,
      }),
    ).rejects.toThrow();
  });
});

describe("resolveAttachmentsForSend (send-time verification)", () => {
  it("rejects a key that doesn't belong to the caller + channel", async () => {
    await expect(
      resolveAttachmentsForSend(ws.workspaceId, channel.id, owner.id, [
        { key: `echo/workspaces/other-ws/channels/x/${owner.id}/abc.png`, filename: "a.png" },
      ]),
    ).rejects.toThrow();
    expect(s3mock.headObject).not.toHaveBeenCalled();
  });

  it("rejects when the object isn't in S3 (incomplete upload)", async () => {
    s3mock.headObject.mockResolvedValue(null);
    await expect(
      resolveAttachmentsForSend(ws.workspaceId, channel.id, owner.id, [
        { key: keyFor(owner.id), filename: "a.png" },
      ]),
    ).rejects.toThrow();
  });

  it("uses S3-authoritative type/size + sanitizes the filename", async () => {
    s3mock.headObject.mockResolvedValue({ contentType: "image/png", contentLength: 4242 });
    const key = keyFor(owner.id);
    const [r] = await resolveAttachmentsForSend(ws.workspaceId, channel.id, owner.id, [
      { key, filename: 'we"ird.png' },
    ]);
    expect(r).toMatchObject({
      category: "image",
      contentType: "image/png",
      sizeBytes: 4242,
      url: `https://bucket.example/${key}`,
    });
    expect(r!.filename).not.toContain('"');
  });
});

describe("sendMessage with attachments", () => {
  it("persists attachments and returns + lists them", async () => {
    s3mock.headObject.mockResolvedValue({ contentType: "image/png", contentLength: 99 });
    const msg = await sendMessage(ws.workspaceId, channel.id, owner.id, {
      clientId: randomUUID(),
      body: "look at this",
      attachments: [{ key: keyFor(owner.id), filename: "pic.png" }],
    });
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments![0]).toMatchObject({ category: "image", filename: "pic.png" });
    // Served via our stable signed-redirect endpoint, never the bucket's public
    // URL — the endpoint 302s each load to a freshly-signed GET (no expiry).
    expect(msg.attachments![0]!.url).toContain("/api/files?key=");

    const list = await listMessages(ws.workspaceId, channel.id, owner.id, { limit: 50 });
    expect(list.find((m) => m.id === msg.id)?.attachments).toHaveLength(1);
  });

  it("keeps attachments on a plain text edit (no keep set provided)", async () => {
    s3mock.headObject.mockResolvedValue({ contentType: "image/png", contentLength: 99 });
    const msg = await sendMessage(ws.workspaceId, channel.id, owner.id, {
      clientId: randomUUID(),
      body: "before",
      attachments: [{ key: keyFor(owner.id), filename: "p.png" }],
    });
    const edited = await editMessage(ws.workspaceId, channel.id, msg.id, owner.id, { body: "after" });
    expect(edited.body).toBe("after");
    expect(edited.attachments).toHaveLength(1);
    expect(edited.attachments![0]).toMatchObject({ category: "image", filename: "p.png" });
  });

  it("reconciles attachments on edit: removes the ones not kept, adds new ones", async () => {
    s3mock.headObject.mockResolvedValue({ contentType: "image/png", contentLength: 99 });
    const msg = await sendMessage(ws.workspaceId, channel.id, owner.id, {
      clientId: randomUUID(),
      body: "two files",
      attachments: [
        { key: keyFor(owner.id), filename: "keep.png" },
        { key: keyFor(owner.id), filename: "drop.png" },
      ],
    });
    const keepId = msg.attachments!.find((a) => a.filename === "keep.png")!.id;

    const edited = await editMessage(ws.workspaceId, channel.id, msg.id, owner.id, {
      body: "edited",
      keepAttachmentIds: [keepId],
      attachments: [{ key: keyFor(owner.id), filename: "added.png" }],
    });

    const names = edited.attachments!.map((a) => a.filename).sort();
    expect(names).toEqual(["added.png", "keep.png"]); // dropped removed, added present
  });

  it("rejects an edit that would leave the message empty", async () => {
    s3mock.headObject.mockResolvedValue({ contentType: "image/png", contentLength: 99 });
    const msg = await sendMessage(ws.workspaceId, channel.id, owner.id, {
      clientId: randomUUID(),
      body: "",
      attachments: [{ key: keyFor(owner.id), filename: "only.png" }],
    });
    await expect(
      editMessage(ws.workspaceId, channel.id, msg.id, owner.id, {
        body: "",
        keepAttachmentIds: [],
        attachments: [],
      }),
    ).rejects.toThrow();
  });

  it("allows a file-only message (empty body)", async () => {
    s3mock.headObject.mockResolvedValue({ contentType: "video/mp4", contentLength: 1000 });
    const msg = await sendMessage(ws.workspaceId, channel.id, owner.id, {
      clientId: randomUUID(),
      body: "",
      attachments: [{ key: keyFor(owner.id, "mp4"), filename: "clip.mp4" }],
    });
    expect(msg.body).toBe("");
    expect(msg.attachments![0]).toMatchObject({ category: "video" });
  });

  it("withholds a departed author's attachments (mirrors body hiding)", async () => {
    const bob = await createUser();
    await addMember(ws.workspaceId, bob.id, "member");
    await joinChannel(ws.workspaceId, bob.id, channel.id);

    s3mock.headObject.mockResolvedValue({ contentType: "image/png", contentLength: 50 });
    const msg = await sendMessage(ws.workspaceId, channel.id, bob.id, {
      clientId: randomUUID(),
      body: "mine",
      attachments: [{ key: keyFor(bob.id), filename: "b.png" }],
    });

    let list = await listMessages(ws.workspaceId, channel.id, owner.id, { limit: 50 });
    expect(list.find((m) => m.id === msg.id)?.attachments).toHaveLength(1);

    await removeMember(ws.workspaceId, bob.id);
    list = await listMessages(ws.workspaceId, channel.id, owner.id, { limit: 50 });
    const found = list.find((m) => m.id === msg.id);
    expect(found?.authorActive).toBe(false);
    expect(found?.attachments).toEqual([]);
  });
});
