import { Check } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useSession } from "@/lib/auth-client";
import { useDirectory } from "@/features/members/api/use-directory";
import { useChannelReads, readersOf } from "../api/use-reads";

/**
 * "Seen by" read-line shown under the latest message. Readers are derived from
 * each member's read cursor (`lastReadSeq >= the message's seq`), minus the
 * viewer and the author. Renders nothing until someone else has caught up.
 *
 * `compact` collapses the whole thing to a bare "Seen" — right for a 1:1, where
 * there is exactly one possible reader so naming them says nothing. Anywhere
 * with more than one other person (a channel OR a group conversation) needs the
 * named form: "Seen" alone can't distinguish one reader from five.
 */
const MAX_AVATARS = 5;

export function SeenBy({
  workspaceId,
  channelId,
  compact,
  lastSeq,
  lastAuthorId,
}: {
  workspaceId: string;
  channelId: string;
  /** Collapse to a bare "Seen" — only correct when one reader is possible. */
  compact: boolean;
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

  if (compact) {
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
  return (
    <UserAvatar
      name={name}
      image={image}
      maxInitials={1}
      className="size-4 text-[8px] ring-1 ring-background"
    />
  );
}
