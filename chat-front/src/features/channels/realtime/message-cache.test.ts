import { describe, expect, it } from "vitest";
import type { MessageWire } from "@server/infrastructure/realtime/protocol";
import {
  mergeBatch,
  mergeMessage,
  optimisticMessage,
  sortMessages,
  OPTIMISTIC_SEQ,
  type ChatMessage,
} from "./message-cache";

/** Build a wire message with sensible defaults; `seq` also seeds createdAt. */
function wire(over: Partial<MessageWire> & { id: string; seq: number }): MessageWire {
  return {
    channelId: "c",
    authorId: "u",
    body: `body-${over.id}`,
    clientId: `cid-${over.id}`,
    updatedSeq: over.seq,
    version: 1,
    deleted: false,
    createdAt: new Date(1_700_000_000_000 + over.seq * 1000).toISOString(),
    updatedAt: null,
    ...over,
  };
}

describe("sortMessages", () => {
  it("orders ascending by seq", () => {
    const out = sortMessages([wire({ id: "b", seq: 3 }), wire({ id: "a", seq: 1 })] as ChatMessage[]);
    expect(out.map((m) => m.seq)).toEqual([1, 3]);
  });
});

describe("mergeMessage", () => {
  it("inserts a new message when allowed", () => {
    const out = mergeMessage([], wire({ id: "m1", seq: 1 }), true);
    expect(out.map((m) => m.id)).toEqual(["m1"]);
  });

  it("does not insert when allowInsert is false (live edit of an unloaded msg)", () => {
    expect(mergeMessage([], wire({ id: "m1", seq: 1 }), false)).toHaveLength(0);
  });

  it("never materializes a delete it hasn't already loaded", () => {
    expect(mergeMessage([], wire({ id: "d1", seq: 1, deleted: true }), true)).toHaveLength(0);
  });

  it("ignores a stale edit (older version)", () => {
    let list = mergeMessage([], wire({ id: "m1", seq: 1, version: 3, body: "v3" }), true);
    list = mergeMessage(list, wire({ id: "m1", seq: 1, version: 2, body: "v2" }), false);
    expect(list[0]!.body).toBe("v3");
  });

  it("reconciles an optimistic row with the server row by clientId (no duplicate)", () => {
    const optimistic = optimisticMessage({
      clientId: "abc",
      channelId: "c",
      authorId: "u",
      body: "hi",
    });
    let list = mergeMessage([], optimistic, true);
    expect(list).toHaveLength(1);
    expect(list[0]!.seq).toBe(OPTIMISTIC_SEQ);

    const server = wire({ id: "real-1", seq: 5, clientId: "abc", body: "hi" });
    list = mergeMessage(list, server, true);

    expect(list).toHaveLength(1); // reconciled in place, not appended
    expect(list[0]!.id).toBe("real-1");
    expect(list[0]!.seq).toBe(5);
    expect(list[0]!.pending).toBeUndefined();
  });
});

describe("mergeBatch (history paging)", () => {
  it("prepends an older page and keeps order", () => {
    let list = sortMessages([wire({ id: "m3", seq: 3 }), wire({ id: "m4", seq: 4 })] as ChatMessage[]);
    list = mergeBatch(list, [wire({ id: "m1", seq: 1 }), wire({ id: "m2", seq: 2 })]);
    expect(list.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
  });

  it("dedupes overlapping pages", () => {
    let list = sortMessages([wire({ id: "m2", seq: 2 }), wire({ id: "m3", seq: 3 })] as ChatMessage[]);
    list = mergeBatch(list, [wire({ id: "m2", seq: 2 }), wire({ id: "m1", seq: 1 })]);
    expect(list.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });
});
