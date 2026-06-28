import { Check } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { useDirectory } from "@/features/members/api/use-directory";
import { useChannelReads, readersOf } from "../api/use-reads";

/**
 * "Seen by" read-line shown under the latest message. Readers are derived from
 * each member's read cursor (`lastReadSeq >= the message's seq`), minus the
 * viewer and the author. Channels show an avatar stack + names; DMs show "Seen".
 * Renders nothing until someone else has caught up.
 */
const MAX_AVATARS = 5;

export function SeenBy({
  workspaceId,
  channelId,
  isDm,
  lastSeq,
  lastAuthorId,
}: {
  workspaceId: string;
  channelId: string;
  isDm: boolean;
  lastSeq: number;
  lastAuthorId: string;
}) {
  const { data: session } = useSession();
  const myId = session?.user.id;
  const { data: reads } = useChannelReads(workspaceId, channelId);
  const { data: directory } = useDirectory(workspaceId);

  const exclude = myId ? [myId, lastAuthorId] : [lastAuthorId];
  const readerIds = readersOf(reads, lastSeq, exclude);
  if (readerIds.length === 0) return null;

  if (isDm) {
    return (
      <div className="flex items-center justify-end gap-1 px-4 pb-1 text-xs text-muted-foreground">
        <Check className="size-3" /> Seen
      </div>
    );
  }

  const names = readerIds.map((id) => directory?.[id]?.name ?? "Someone");
  const label =
    names.length <= 3 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;

  return (
    <div
      className="flex items-center justify-end gap-1.5 px-4 pb-1 text-xs text-muted-foreground"
      title={`Seen by ${names.join(", ")}`}
    >
      <div className="flex -space-x-1.5">
        {readerIds.slice(0, MAX_AVATARS).map((id) => (
          <Avatar key={id} name={directory?.[id]?.name ?? "?"} image={directory?.[id]?.image ?? null} />
        ))}
      </div>
      <span>Seen by {label}</span>
    </div>
  );
}

function Avatar({ name, image }: { name: string; image: string | null }) {
  if (image) {
    return (
      <img src={image} alt="" className="size-4 rounded-full object-cover ring-1 ring-background" />
    );
  }
  return (
    <span className="flex size-4 items-center justify-center rounded-full bg-muted text-[8px] font-medium text-muted-foreground ring-1 ring-background">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
