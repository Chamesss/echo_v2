import { describe, expect, it } from "vitest";
import { readersOf, upsertRead, type ChannelReadDTO } from "./use-reads";

const reads: ChannelReadDTO[] = [
  { userId: "alice", lastReadSeq: 5 },
  { userId: "bob", lastReadSeq: 3 },
  { userId: "me", lastReadSeq: 9 },
];

describe("readersOf", () => {
  it("returns members whose cursor reached the seq, minus the excluded", () => {
    // At seq 4: alice (5) and me (9) qualify; bob (3) hasn't.
    expect(readersOf(reads, 4, ["me", "alice"])).toEqual([]); // both qualifiers excluded
    expect(readersOf(reads, 4, ["me"])).toEqual(["alice"]);
    expect(readersOf(reads, 3, ["me"])).toEqual(["alice", "bob"]);
  });

  it("is empty when nobody (else) has caught up", () => {
    expect(readersOf(reads, 6, ["me"])).toEqual([]); // only me (9) ≥ 6, excluded
    expect(readersOf(undefined, 1, [])).toEqual([]);
  });
});

describe("upsertRead", () => {
  it("inserts a new cursor", () => {
    expect(upsertRead([], "alice", 2)).toEqual([{ userId: "alice", lastReadSeq: 2 }]);
  });

  it("advances an existing cursor but never moves it backwards", () => {
    const list = [{ userId: "alice", lastReadSeq: 5 }];
    expect(upsertRead(list, "alice", 7)[0]).toMatchObject({ lastReadSeq: 7 });
    // Lower/equal seq is a no-op (returns the same reference).
    expect(upsertRead(list, "alice", 3)).toBe(list);
    expect(upsertRead(list, "alice", 5)).toBe(list);
  });
});
