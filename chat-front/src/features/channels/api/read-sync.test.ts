import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { NotificationSummary } from "@server/modules/notifications/notifications.service";
import { channelsKey } from "./keys";
import { dmsKey } from "./use-dms";
import { notificationsSummaryKey } from "@/features/notifications/api/keys";
import { clearConversationUnread } from "./read-sync";

const WS = "w1";

function setup(summaryUnread: number, channels: Array<{ id: string; unread: number }>) {
  const qc = new QueryClient();
  qc.setQueryData(channelsKey(WS), channels);
  qc.setQueryData<NotificationSummary>(notificationsSummaryKey, {
    unseen: 0,
    workspaces: [{ workspaceId: WS, unread: summaryUnread, notifications: 0 }],
  });
  return qc;
}

const wsUnread = (qc: QueryClient) =>
  qc.getQueryData<NotificationSummary>(notificationsSummaryKey)!.workspaces[0]!.unread;
const chUnread = (qc: QueryClient, id: string) =>
  qc.getQueryData<Array<{ id: string; unread: number }>>(channelsKey(WS))!.find((c) => c.id === id)!
    .unread;

describe("clearConversationUnread", () => {
  it("zeroes the channel badge and decrements the workspace roll-up by that amount", () => {
    const qc = setup(5, [
      { id: "c1", unread: 3 },
      { id: "c2", unread: 2 },
    ]);
    clearConversationUnread(qc, WS, "c1");
    expect(chUnread(qc, "c1")).toBe(0);
    expect(chUnread(qc, "c2")).toBe(2); // untouched
    expect(wsUnread(qc)).toBe(2); // 5 - 3
  });

  it("is idempotent — a second call (already 0) doesn't decrement again", () => {
    const qc = setup(5, [{ id: "c1", unread: 3 }]);
    clearConversationUnread(qc, WS, "c1");
    clearConversationUnread(qc, WS, "c1");
    expect(wsUnread(qc)).toBe(2); // still 5 - 3, not 5 - 3 - 3
  });

  it("works when the conversation is a DM (lives in the dms cache)", () => {
    const qc = setup(4, []);
    qc.setQueryData(dmsKey(WS), [{ id: "d1", unread: 4 }]);
    clearConversationUnread(qc, WS, "d1");
    expect(wsUnread(qc)).toBe(0); // 4 - 4
    expect(
      qc.getQueryData<Array<{ id: string; unread: number }>>(dmsKey(WS))!.find((d) => d.id === "d1")!
        .unread,
    ).toBe(0);
  });
});
