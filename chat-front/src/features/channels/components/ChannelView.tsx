import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Hash, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";
import { useChannels, useJoinChannel, type ChannelDTO } from "../api/use-channels";
import { useMarkRead, useMessages } from "../api/use-messages";
import { OPTIMISTIC_SEQ } from "../realtime/message-cache";
import { useChannelStream } from "../realtime/use-channel-stream";
import { MessageComposer } from "./MessageComposer";
import { MessageList } from "./MessageList";

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
  const { data: channels, isPending } = useChannels(workspace.id);
  const join = useJoinChannel(workspace.id);

  const channel = channels?.find((c) => c.id === channelId);

  if (isPending && !channel) {
    return <Centered>Loading channel…</Centered>;
  }
  if (!channel) {
    return <Centered>Channel not found.</Centered>;
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        {channel.type === "private" ? <Lock className="size-4" /> : <Hash className="size-4" />}
        <span className="font-semibold text-foreground">{channel.name}</span>
      </header>

      {channel.isMember ? (
        <ChannelMessages channel={channel} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <p>You're not a member of this channel yet.</p>
          <Button
            size="sm"
            disabled={join.isPending}
            onClick={() =>
              join.mutate(channel.id, { onError: (err) => toast.error(err.message) })
            }
          >
            {join.isPending ? "Joining…" : "Join channel"}
          </Button>
        </div>
      )}
    </div>
  );
}

function ChannelMessages({ channel }: { channel: ChannelDTO }) {
  const workspace = useCurrentWorkspace();
  const { data: messages = [], isPending } = useMessages(workspace.id, channel.id);
  const markRead = useMarkRead(workspace.id, channel.id);
  const lastMarked = useRef(0);

  // Live updates + gap/reconnect reconciliation for this channel.
  useChannelStream(channel.id, channel.lastSeq);

  // While the channel is open, keep the read cursor at the newest real message.
  useEffect(() => {
    const maxSeq = messages.reduce(
      (max, m) => (m.seq === OPTIMISTIC_SEQ ? max : Math.max(max, m.seq)),
      0,
    );
    if (maxSeq > lastMarked.current) {
      lastMarked.current = maxSeq;
      markRead.mutate(maxSeq);
    }
  }, [messages, markRead]);

  if (isPending) return <Centered>Loading messages…</Centered>;

  return (
    <>
      <MessageList messages={messages} />
      <MessageComposer channelId={channel.id} />
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
