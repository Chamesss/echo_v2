import { Hash, Lock } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useSession } from "@/lib/auth-client";
import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";
import { usePresence } from "@/features/members/api/use-presence";
import type { ChannelDTO } from "../api/use-channels";
import type { DirectMessageDTO } from "../api/use-dms";

/**
 * Frames the very TOP of a conversation. Rendered once the oldest message is
 * loaded (or a brand-new conversation has none), so the timeline has a clear
 * beginning instead of messages starting mid-air. Channels show their icon +
 * name + topic + created date; DMs show the other participant(s)' avatars.
 */
export function ConversationStart({
  channel,
  empty,
}: {
  channel: ChannelDTO | DirectMessageDTO;
  empty: boolean;
}) {
  const isDm = channel.type === "direct" || channel.type === "group";
  return (
    <div className="mb-3 border-b border-border/60 px-1 pb-5 pt-2">
      {isDm ? (
        <DmIntro channel={channel as DirectMessageDTO} />
      ) : (
        <ChannelIntro channel={channel} />
      )}
      {empty && (
        <p className="mt-4 text-sm text-muted-foreground">
          No messages yet — {isDm ? "say hello" : "be the first to post"}.
        </p>
      )}
    </div>
  );
}

function ChannelIntro({ channel }: { channel: ChannelDTO }) {
  const isPrivate = channel.type === "private";
  const Icon = isPrivate ? Lock : Hash;
  const name = channel.name ?? "channel";
  return (
    <>
      <div className="mb-3 flex size-12 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <Icon className="size-6" />
      </div>
      <h2 className="flex items-center gap-1 text-xl font-bold text-foreground">
        {!isPrivate && <span className="text-muted-foreground">#</span>}
        {name}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        This is the very beginning of the{" "}
        <span className="font-medium text-foreground">
          {isPrivate ? "" : "#"}
          {name}
        </span>{" "}
        {isPrivate ? "private channel" : "channel"}.
      </p>
      {channel.topic && <p className="mt-2 text-sm text-foreground">{channel.topic}</p>}
      <p className="mt-2 text-xs text-muted-foreground">
        Created {formatDate(channel.createdAt)}
      </p>
    </>
  );
}

function DmIntro({ channel }: { channel: DirectMessageDTO }) {
  const { data: session } = useSession();
  const workspace = useCurrentWorkspace();
  const { data: online } = usePresence(workspace.id);
  const myId = session?.user.id;
  // Hold off until the session resolves: without it YOU are counted among the
  // others, so a 1:1 renders as a group with your own name in the heading.
  const others = myId ? channel.participants.filter((p) => p.userId !== myId) : [];
  const people = others.length ? others : channel.participants;
  // Type, not headcount. A group that has shrunk to two people is still a group
  // — deriving this from `people.length` disagreed with the type and flipped the
  // copy underneath the user.
  const isGroup = channel.type === "group";
  const names = people.map((p) => p.name).join(", ");
  // Only a 1:1 gets a dot — the avatars below overlap (`-space-x-2`), so on a
  // group each dot would sit under the next person's face.
  const solo = people.length === 1;
  const shown = people.slice(0, 3);
  const overflow = people.length - shown.length;

  return (
    <>
      <div className="mb-3 flex -space-x-2">
        {shown.map((p) => (
          <UserAvatar
            key={p.userId}
            name={p.name}
            image={p.image}
            className="size-10 ring-2 ring-background"
            priority
            online={solo && online ? online.has(p.userId) : undefined}
          />
        ))}
        {overflow > 0 && (
          // The heading lists everyone, so silently dropping faces past the
          // third made the two disagree.
          <span className="flex size-10 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground ring-2 ring-background">
            +{overflow}
          </span>
        )}
      </div>
      <h2 className="text-xl font-bold text-foreground">{names}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {isGroup ? (
          "This is the very beginning of this group conversation."
        ) : (
          <>
            This is the very beginning of your direct message history with{" "}
            <span className="font-medium text-foreground">{names}</span>.
          </>
        )}
      </p>
    </>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
