import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { isChannelEvent } from "@server/infrastructure/realtime/protocol";
import { useSession } from "@/lib/auth-client";
import { clearLastWorkspaceId } from "@/lib/local-storage";
import { paths } from "@/lib/paths";
import { useCurrentWorkspace } from "@/features/workspaces/context/workspace-context";
import { useRealtime } from "@/features/channels/realtime/realtime-context";
import { myWorkspacesKey } from "@/features/workspaces/api/use-my-workspaces";
import { workspaceKey } from "@/features/workspaces/api/use-workspace";
import { directoryKey, invitesKey, membersKey, presenceKey } from "@/features/members/api/keys";
import type { PresenceResponse } from "@/features/members/api/use-presence";
import { channelsKey, channelMembersKey } from "@/features/channels/api/keys";
import type { EchoMessage } from "@/features/channels/realtime/message-cache";

/**
 * Live-syncs workspace-wide roster changes into the cache so a member
 * joining/leaving/role-changing reflects immediately — no page reload.
 *
 * Channel message events are handled by `useChannelStream`; this hook owns the
 * workspace-scoped events the server broadcasts to every socket. For each, the
 * DB stays the source of truth: we invalidate the affected REST queries (roster,
 * directory, my-workspaces, invites) and re-read rather than trusting the event
 * to carry state. The one local mutation is withholding a departed member's
 * already-loaded messages — which exactly mirrors the server's read-time hiding,
 * so it can't drift, and rejoining refetches the real bodies back.
 *
 * Mounted once inside the workspace shell (where the realtime client + workspace
 * context live).
 */
export function useWorkspaceEvents() {
  const { client } = useRealtime();
  const workspace = useCurrentWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const myUserId = session?.user.id;
  const workspaceId = workspace.id;

  useEffect(() => {
    return client.onEvent((event) => {
      if (isChannelEvent(event)) return; // message timeline is reconciled elsewhere

      switch (event.kind) {
        // ── Workspace ─────────────────────────────────────────────────────
        case "workspace.updated":
          // Renamed → re-read the workspace (name in rail/switcher/header).
          qc.invalidateQueries({ queryKey: workspaceKey(workspaceId) });
          qc.invalidateQueries({ queryKey: myWorkspacesKey });
          break;
        case "directory.updated":
          // A member changed their name/avatar → re-read the directory so author
          // names/avatars refresh live across every open conversation.
          qc.invalidateQueries({ queryKey: directoryKey(workspaceId) });
          break;
        case "presence.changed":
          // The one event here that PATCHES instead of invalidating. Everywhere
          // else the event only says "something changed, re-read it" — but
          // presence has no cheaper source than the event itself (refetching the
          // whole snapshot because one person opened a tab would be absurd), and
          // the payload is already the complete truth for that user.
          qc.setQueryData<PresenceResponse>(presenceKey(workspaceId), (prev) => {
            if (!prev) return prev; // not loaded yet; the first fetch will be current
            if (prev.online.includes(event.userId) === event.online) return prev;
            return {
              online: event.online
                ? [...prev.online, event.userId]
                : prev.online.filter((id) => id !== event.userId),
            };
          });
          break;

        // ── Channel lifecycle ─────────────────────────────────────────────
        // The event carries only the id; re-read the (visibility-scoped) list so
        // a new public channel appears, a rename/topic/archive/member-set change
        // reflects, and a deletion drops it — the DB stays the source of truth.
        case "channel.created":
        case "channel.updated":
          qc.invalidateQueries({ queryKey: channelsKey(workspaceId) });
          qc.invalidateQueries({ queryKey: channelMembersKey(workspaceId, event.channelId) });
          break;
        case "channel.deleted":
          qc.invalidateQueries({ queryKey: channelsKey(workspaceId) });
          // If I'm currently viewing the deleted channel, don't strand me on a
          // "not found" view — bounce to the workspace home.
          if (
            window.location.pathname ===
            paths.workspaceChannel(workspaceId, event.channelId)
          ) {
            toast.info("This channel was deleted");
            navigate(paths.workspace(workspaceId), { replace: true });
          }
          break;

        // ── Roster ────────────────────────────────────────────────────────
        // Any roster change can affect the roster view, author resolution, the
        // workspace list (role/membership), and pending invites — re-read them.
        case "member.removed":
        case "member.added":
        case "member.role_changed": {
          qc.invalidateQueries({ queryKey: membersKey(workspaceId) });
          qc.invalidateQueries({ queryKey: directoryKey(workspaceId) });
          qc.invalidateQueries({ queryKey: myWorkspacesKey });
          qc.invalidateQueries({ queryKey: invitesKey(workspaceId) });

          if (event.kind === "member.removed") {
            if (event.userId === myUserId) {
              // I was removed (or left from another device): I no longer belong
              // here, so leave the workspace shell for the dashboard.
              clearLastWorkspaceId();
              toast.info("You're no longer a member of this workspace");
              navigate(paths.home, { replace: true });
              return;
            }
            // Someone else departed: withhold their messages in every loaded
            // channel, matching what the server now returns on a fresh read.
            withholdAuthorMessages(qc, workspaceId, event.userId);
          } else if (event.kind === "member.added") {
            // A (re)joining member's messages may have been withheld; the real
            // bodies live only on the server, so refetch to restore them.
            qc.invalidateQueries({ queryKey: ["ws", workspaceId, "channel"] });
          }
          break;
        }
      }
    });
  }, [client, qc, navigate, workspaceId, myUserId]);

  // Presence transitions that happened while the socket was down are gone —
  // NOTIFY doesn't replay, and presence is the only cache here with no other
  // refresh path (the rest re-read on their own mounts). Re-seed on reconnect.
  useEffect(() => {
    return client.onStatus((status, reconnected) => {
      if (status === "open" && reconnected) {
        qc.invalidateQueries({ queryKey: presenceKey(workspaceId) });
      }
    });
  }, [client, qc, workspaceId]);
}

/**
 * Blank out a departed author's loaded messages across every cached channel,
 * mirroring the server's read-time hiding (`authorActive=false`, empty body) so
 * the UI shows "Message unavailable" from a "Former member" without a reload.
 *
 * Exported for unit testing the cache-key filtering + blanking in isolation.
 */
export function withholdAuthorMessages(qc: QueryClient, workspaceId: string, authorId: string): void {
  const caches = qc.getQueriesData<EchoMessage[]>({ queryKey: ["ws", workspaceId, "channel"] });
  for (const [key, data] of caches) {
    // The channel namespace also holds the channel-members list; only touch the
    // message arrays (`[..., "messages"]`).
    if (key[4] !== "messages" || !data) continue;
    let changed = false;
    const next = data.map((m) => {
      if (m.authorId === authorId && m.authorActive !== false) {
        changed = true;
        return { ...m, authorActive: false, body: "" };
      }
      return m;
    });
    if (changed) qc.setQueryData<EchoMessage[]>(key, next);
  }
}
