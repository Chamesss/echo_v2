import { useEffect, useRef, useState } from "react";
import { toastError } from "@/lib/toast-error";
import { Hash, Lock, Settings, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isTabVisible } from "@/lib/visibility";
import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";
import {
  useChannels,
  useJoinChannel,
  type ChannelDTO,
} from "../api/use-channels";
import { useDirectMessages, type DirectMessageDTO } from "../api/use-dms";
import { useMarkRead, useMessages } from "../api/use-messages";
import { useMarkRead as useMarkNotificationsRead } from "@/features/notifications/api/use-notifications";
import { OPTIMISTIC_SEQ } from "../realtime/message-cache";
import { useChannelStream } from "../realtime/use-channel-stream";
import { ChannelSettingsDialog } from "./ChannelSettingsDialog";
import { MessageComposer } from "./MessageComposer";
import { MessageList } from "./MessageList";
import { TypingIndicator } from "./TypingIndicator";

/**
 * A single channel: header + live message timeline + composer.
 *
 * Looks the channel up from the (cached) channels list. Non-members get a join
 * prompt; the message subtree (`ChannelMessages`) only mounts once the user is a
 * member, so its hooks — history load, the realtime stream, mark-read — never
 * fire against a channel the API would 403.
 */
export function ChannelView({ channelId }: { channelId: string }) {
  const workspace = useCurrentWorkspace();
  const { data: channels, isPending: channelsPending } = useChannels(
    workspace.id,
  );
  const { data: dms, isPending: dmsPending } = useDirectMessages(workspace.id);
  const join = useJoinChannel(workspace.id);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const channel =
    channels?.find((c) => c.id === channelId) ??
    dms?.find((d) => d.id === channelId);

  if (!channel) {
    if (channelsPending || dmsPending)
      return <Centered>Loading channel…</Centered>;
    return <Centered>Channel not found.</Centered>;
  }

  // Deliberately NOT one `isDm` flag. A 1:1 is fixed — no name, no topic, no
  // member list, nothing to manage. A group is a conversation you own: it can
  // be renamed and its members can change. Folding the two together is what hid
  // the settings gear from groups and reduced their read receipts to "Seen".
  const isDirect = channel.type === "direct";
  const isGroup = channel.type === "group";
  // Only the DM list carries participants, and only these two types come from
  // it. `DirectMessageDTO extends ChannelDTO`, so the union collapses and `in`
  // narrowing can't see the field — the type discriminant is the reliable test.
  const conversation = isDirect || isGroup ? (channel as DirectMessageDTO) : null;
  const memberCount = conversation?.participants.length ?? null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        {isDirect || isGroup ? (
          <Users className="size-4" />
        ) : channel.type === "private" ? (
          <Lock className="size-4" />
        ) : (
          <Hash className="size-4" />
        )}
        <span className="truncate font-semibold text-foreground">{channel.name}</span>
        {isGroup && memberCount !== null && (
          <span className="shrink-0 text-xs text-muted-foreground">{memberCount}</span>
        )}
        {channel.topic && (
          <span className="ml-1 hidden truncate border-l border-border pl-3 text-sm text-muted-foreground sm:block">
            {channel.topic}
          </span>
        )}
        {/* A 1:1 has nothing to configure; everything else does. */}
        {channel.isMember && !isDirect && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto shrink-0"
            aria-label="Channel settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings />
          </Button>
        )}
      </header>

      {settingsOpen && !isDirect && (
        <ChannelSettingsDialog
          channel={channel}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {channel.isMember ? (
        <ChannelMessages channel={channel} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <p>You're not a member of this channel yet.</p>
          <Button
            size="sm"
            disabled={join.isPending}
            onClick={() =>
              join.mutate(channel.id, {
                onError: toastError,
              })
            }
          >
            {join.isPending ? "Joining…" : "Join channel"}
          </Button>
        </div>
      )}
    </div>
  );
}

function ChannelMessages({
  channel,
}: {
  channel: ChannelDTO | DirectMessageDTO;
}) {
  const workspace = useCurrentWorkspace();
  const { data: messages = [], isPending } = useMessages(
    workspace.id,
    channel.id,
  );
  const markRead = useMarkRead(workspace.id, channel.id);
  const markNotificationsRead = useMarkNotificationsRead();
  const lastMarked = useRef(0);

  // Live updates + gap/reconnect reconciliation for this channel.
  useChannelStream(channel.id, channel.lastSeq);

  // Opening any conversation clears its inbox notifications (bell + badges).
  // Messages that arrive while it's open + focused are skipped by the awareness
  // provider, so they don't re-accumulate.
  useEffect(() => {
    markNotificationsRead.mutate({ channelId: channel.id });
    // Fire once per opened channel; the mutation handle is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  // Read cursor = the "seen" signal. Advance to the newest real message while the
  // tab is VISIBLE (the foreground tab). We use visibilityState, NOT
  // document.hasFocus(): hasFocus() is false whenever DevTools or another window
  // holds OS focus, which would wrongly freeze the cursor (unread never clears,
  // receipts never advance). A message that lands on a hidden/background tab stays
  // unread until the tab is shown again (re-checked on visibilitychange).
  const markReadMutate = markRead.mutate;
  useEffect(() => {
    const advance = () => {
      if (!isTabVisible()) return;
      const maxSeq = messages.reduce(
        (max, m) => (m.seq === OPTIMISTIC_SEQ ? max : Math.max(max, m.seq)),
        0,
      );
      if (maxSeq > lastMarked.current) {
        lastMarked.current = maxSeq;
        markReadMutate(maxSeq);
      }
    };
    advance();
    document.addEventListener("visibilitychange", advance);
    return () => document.removeEventListener("visibilitychange", advance);
  }, [messages, markReadMutate]);

  if (isPending) return <Centered>Loading messages…</Centered>;

  return (
    <>
      <MessageList channel={channel} messages={messages} />
      <TypingIndicator channelId={channel.id} />
      <MessageComposer channelId={channel.id} />
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  // `flex-1` and `h-full` cover the two parents this renders under, and each is
  // inert where the other applies. Below the channel header it's a flex item, so
  // `flex-1` sizes it (a definite flex-basis wins over `height`). On the
  // early-return path it IS the route root, sitting directly in the shell's
  // `<main>` — a block box, where `flex-1` does nothing and only `h-full` gives
  // it the height to center against.
  return (
    <div className="flex h-full flex-1 items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
