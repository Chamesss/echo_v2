import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/features/channels/realtime/message-cache";
import { messagesKey, channelMembersKey } from "@/features/channels/api/keys";
import { membersKey } from "@/features/members/api/keys";
import { withholdAuthorMessages } from "./use-workspace-events";

function msg(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    channelId: "c1",
    authorId: "u1",
    body: "secret",
    clientId: "cid",
    seq: 1,
    updatedSeq: 1,
    version: 1,
    deleted: false,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: null,
    ...over,
  };
}

const ws = "w1";

describe("withholdAuthorMessages", () => {
  it("blanks the departed author's messages across every channel cache, leaving others", () => {
    const qc = new QueryClient();
    qc.setQueryData<ChatMessage[]>(messagesKey(ws, "c1"), [
      msg({ id: "a", authorId: "gone", body: "from gone" }),
      msg({ id: "b", authorId: "stay", body: "from stay" }),
    ]);
    qc.setQueryData<ChatMessage[]>(messagesKey(ws, "c2"), [
      msg({ id: "c", channelId: "c2", authorId: "gone", body: "also gone" }),
    ]);

    withholdAuthorMessages(qc, ws, "gone");

    const c1 = qc.getQueryData<ChatMessage[]>(messagesKey(ws, "c1"))!;
    expect(c1.find((m) => m.id === "a")).toMatchObject({ body: "", authorActive: false });
    // The other author's message is untouched (not blanked, no authorActive flag).
    const stay = c1.find((m) => m.id === "b")!;
    expect(stay.body).toBe("from stay");
    expect(stay.authorActive).toBeUndefined();

    const c2 = qc.getQueryData<ChatMessage[]>(messagesKey(ws, "c2"))!;
    expect(c2[0]).toMatchObject({ body: "", authorActive: false });
  });

  it("ignores non-message caches under the channel namespace", () => {
    const qc = new QueryClient();
    // channel-members and roster live under overlapping key prefixes; they must
    // not be treated as message arrays.
    const members = [{ userId: "gone", name: "Gone", role: "member" }];
    qc.setQueryData(channelMembersKey(ws, "c1"), members);
    qc.setQueryData(membersKey(ws), members);

    withholdAuthorMessages(qc, ws, "gone");

    expect(qc.getQueryData(channelMembersKey(ws, "c1"))).toEqual(members);
    expect(qc.getQueryData(membersKey(ws))).toEqual(members);
  });
});
