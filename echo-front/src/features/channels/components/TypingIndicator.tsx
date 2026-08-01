import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";
import { useDirectory } from "@/features/members/api/use-directory";
import { useTypingParticipants } from "../realtime/use-typing";

/**
 * "Alice is typing…" between the timeline and the composer.
 *
 * The row keeps its height whether or not anyone is typing: an element that
 * appeared and disappeared here would shove the timeline up and down on every
 * pause, which reads as jitter rather than as information.
 *
 * Names come from the same directory that resolves message authors, so a rename
 * reflects here live too. Anyone the directory can't resolve is dropped — the
 * count falls back with them, which is the honest thing to show.
 */
export function TypingIndicator({ channelId }: { channelId: string }) {
  const workspace = useCurrentWorkspace();
  const { data: directory } = useDirectory(workspace.id);
  const typing = useTypingParticipants(channelId);

  const names = typing
    .map((id) => directory?.[id]?.name)
    .filter((name): name is string => Boolean(name));

  let text = "";
  if (names.length === 1) text = `${names[0]} is typing…`;
  else if (names.length === 2) text = `${names[0]} and ${names[1]} are typing…`;
  else if (names.length > 2) text = "Several people are typing…";

  return (
    <div
      className="h-5 shrink-0 px-6 text-xs italic text-muted-foreground"
      aria-live="polite"
    >
      {text}
    </div>
  );
}
