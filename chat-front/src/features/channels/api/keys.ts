/** React Query keys for channel data, scoped by workspace. */
export const channelsKey = (workspaceId: string) => ["ws", workspaceId, "channels"] as const;

export const messagesKey = (workspaceId: string, channelId: string) =>
  ["ws", workspaceId, "channel", channelId, "messages"] as const;

/** Whether the channel has older history to page in (set by the initial load). */
export const historyKey = (workspaceId: string, channelId: string) =>
  ["ws", workspaceId, "channel", channelId, "has-older"] as const;

export const channelMembersKey = (workspaceId: string, channelId: string) =>
  ["ws", workspaceId, "channel", channelId, "members"] as const;

/** Per-member read cursors for a channel — the basis for "seen by" receipts. */
export const readsKey = (workspaceId: string, channelId: string) =>
  ["ws", workspaceId, "channel", channelId, "reads"] as const;
