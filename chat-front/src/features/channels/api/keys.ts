/** React Query keys for channel data, scoped by workspace. */
export const channelsKey = (workspaceId: string) => ["ws", workspaceId, "channels"] as const;

export const messagesKey = (workspaceId: string, channelId: string) =>
  ["ws", workspaceId, "channel", channelId, "messages"] as const;
