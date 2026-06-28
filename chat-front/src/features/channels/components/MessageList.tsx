import { useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";
import { useDirectory } from "@/features/members/api/use-directory";
import {
  useDeleteMessage,
  useEditMessage,
  useOlderMessages,
} from "../api/use-messages";
import { OPTIMISTIC_SEQ, type ChatMessage } from "../realtime/message-cache";
import type { ChannelDTO } from "../api/use-channels";
import type { DirectMessageDTO } from "../api/use-dms";
import { ConversationStart } from "./ConversationStart";
import { MessageRow } from "./MessageRow";
import { SeenBy } from "./SeenBy";

/**
 * Scrollable message timeline. Resolves author names/avatars from the workspace
 * directory, renders each row via `MessageRow` (with edit/delete for the
 * caller's own messages), and pages older history in on scroll-to-top — keeping
 * the scroll anchored so the view doesn't jump. New messages stick to the bottom.
 */
export function MessageList({
  channel,
  messages,
}: {
  channel: ChannelDTO | DirectMessageDTO;
  messages: ChatMessage[];
}) {
  const channelId = channel.id;
  const isDm = channel.type === "direct" || channel.type === "group";
  const workspace = useCurrentWorkspace();
  const { data: session } = useSession();
  const myId = session?.user.id;
  const { data: directory } = useDirectory(workspace.id);

  const edit = useEditMessage(workspace.id, channelId);
  const del = useDeleteMessage(workspace.id, channelId);
  const { loadOlder, isLoading, hasMore } = useOlderMessages(
    workspace.id,
    channelId,
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const prevHeightRef = useRef(0);
  const prependingRef = useRef(false);
  const prevLenRef = useRef(0);

  // Remember the scroll height before a prepend so we can restore the offset.
  const beginPrepend = () => {
    const el = containerRef.current;
    if (!el) return;
    prevHeightRef.current = el.scrollHeight;
    prependingRef.current = true;
    void loadOlder();
  };

  const onScroll = () => {
    const el = containerRef.current;
    if (!el || isLoading || !hasMore) return;
    if (el.scrollTop <= 48) beginPrepend();
  };

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (prependingRef.current) {
      // Older page prepended → keep the previously-visible message in place.
      el.scrollTop = el.scrollHeight - prevHeightRef.current;
      prependingRef.current = false;
    } else if (messages.length > prevLenRef.current) {
      // New message(s) appended → stick to the bottom.
      el.scrollTop = el.scrollHeight;
    }
    prevLenRef.current = messages.length;
  }, [messages]);

  const authorName = (m: ChatMessage): string => {
    if (m.authorActive === false) return "Former member";
    // if (m.authorId === myId) return "You";
    // Prefer the live directory (renames stay fresh); fall back to the author
    // snapshot the server embeds on read paths so a cold refresh never flashes a
    // raw id. The "…" placeholder only shows for a live message that arrives
    // before the directory loads (write-path events carry no snapshot).
    return (
      directory?.[m.authorId]?.name ??
      m.authorName ??
      (directory ? "Unknown member" : "…")
    );
  };

  // The newest delivered (non-optimistic) message anchors the "Seen by" line.
  const lastReal = [...messages]
    .reverse()
    .find((m) => m.seq !== OPTIMISTIC_SEQ);

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="flex-1 space-y-3 overflow-y-auto p-4"
    >
      {hasMore ? (
        <div className="flex justify-center pb-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={isLoading}
            onClick={beginPrepend}
          >
            {isLoading ? "Loading…" : "Load earlier messages"}
          </Button>
        </div>
      ) : (
        // No older history → we're at the true beginning: frame it instead of
        // letting messages start mid-air.
        <ConversationStart channel={channel} empty={messages.length === 0} />
      )}

      {messages.map((m) => (
        <MessageRow
          key={m.id}
          message={m}
          isOwn={m.authorId === myId}
          authorName={authorName(m)}
          authorImage={
            m.authorActive === false
              ? null
              : (directory?.[m.authorId]?.image ?? m.authorImage ?? null)
          }
          onEdit={(id, payload) =>
            edit.mutate(
              { messageId: id, ...payload },
              { onError: (err) => toast.error(err.message) },
            )
          }
          onDelete={(id) =>
            del.mutate(id, { onError: (err) => toast.error(err.message) })
          }
        />
      ))}

      {lastReal && (
        <SeenBy
          workspaceId={workspace.id}
          channelId={channelId}
          isDm={isDm}
          lastSeq={lastReal.seq}
          lastAuthorId={lastReal.authorId}
        />
      )}
    </div>
  );
}
