/** React Query keys for membership data, scoped by workspace. */
export const membersKey = (workspaceId: string) => ["ws", workspaceId, "members"] as const;
export const invitesKey = (workspaceId: string) => ["ws", workspaceId, "invites"] as const;
export const directoryKey = (workspaceId: string) => ["ws", workspaceId, "directory"] as const;
