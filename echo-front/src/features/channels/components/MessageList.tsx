import { useEffect, useLayoutEffect, useRef } from "react";
import { toastError } from "@/lib/toast-error";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";
import { useDirectory } from "@/features/members/api/use-directory";
import { usePresence } from "@/features/members/api/use-presence";
import {
  useDeleteMessage,
  useDiscardFailed,
  useEditMessage,
  useOlderMessages,
  useRetrySend,
} from "../api/use-messages";
import { OPTIMISTIC_SEQ, type EchoMessage } from "../realtime/message-cache";
import type { ChannelDTO } from "../api/use-channels";
import type { DirectMessageDTO } from "../api/use-dms";
import { ConversationStart } from "./ConversationStart";
import { MessageRow } from "./MessageRow";
import { SeenBy } from "./SeenBy";

/** Slack-ish tolerance for "parked at the bottom" — survives sub-pixel rounding. */
const BOTTOM_SLACK_PX = 16;

/**
 * Scrollable message timeline. Resolves author names/avatars from the workspace
 * directory, renders each row via `MessageRow` (with edit/delete for the
 * caller's own messages), and pages older history in on scroll-to-top — keeping
 * the scroll anchored so the view doesn't jump. New messages stick to the bottom,
 * including when the content grows late (read receipts, images) under a reader
 * who was already there.
 */
export function MessageList({
  channel,
  messages,
}: {
  channel: ChannelDTO | DirectMessageDTO;
  messages: EchoMessage[];
}) {
  const channelId = channel.id;
  // Only a 1:1 gets the collapsed "Seen" receipt: there's exactly one other
  // person, so naming them adds nothing. A group has several readers, and which
  // of them has caught up is the whole point.
  const isDirect = channel.type === "direct";
  const workspace = useCurrentWorkspace();
  const { data: session } = useSession();
  const myId = session?.user.id;
  const { data: directory } = useDirectory(workspace.id);
  const { data: online } = usePresence(workspace.id);

  const edit = useEditMessage(workspace.id, channelId);
  const del = useDeleteMessage(workspace.id, channelId);
  const retry = useRetrySend(workspace.id, channelId);
  const discard = useDiscardFailed(workspace.id, channelId);
  const { loadOlder, isLoading, hasMore } = useOlderMessages(
    workspace.id,
    channelId,
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const prevHeightRef = useRef(0);
  const prependingRef = useRef(false);
  const prevLenRef = useRef(0);
  /** Was the reader parked at the bottom before the last layout change? */
  const atBottomRef = useRef(true);

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
    if (!el) return;
    atBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX;
    if (isLoading || !hasMore) return;
    if (el.scrollTop <= 48) beginPrepend();
  };

  /**
   * Re-pin to the bottom when content grows for reasons React doesn't drive —
   * the read receipt loading, an image decoding, an attachment laying out. Each
   * pushed the newest message out of view a beat after it settled. A reader who
   * scrolled up is left alone.
   */
  useEffect(() => {
    const el = containerRef.current;
    const content = contentRef.current;
    // jsdom has no ResizeObserver; nothing here is load-bearing for correctness.
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current && !prependingRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

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
      atBottomRef.current = true;
    }
    prevLenRef.current = messages.length;
  }, [messages]);

  const authorName = (m: EchoMessage): string => {
    if (m.authorActive === false) return "Former member";
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
    // Two elements, not one: the outer box scrolls, the inner box is the content
    // whose height the ResizeObserver above watches. Observing the scroller
    // itself would report the viewport (which doesn't change when a line is
    // added), so the growth we care about would be invisible.
    <div ref={containerRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
      <div
        ref={contentRef}
        // Row spacing is density-driven; `Compact` tightens the timeline without
        // touching any other layout.
        className="space-y-[var(--density-gap)] p-4"
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
            // A departed member isn't in the roster, so they have no presence to
            // show — same reason their avatar is blanked above.
            authorOnline={
              m.authorActive === false || !online
                ? undefined
                : online.has(m.authorId)
            }
            onEdit={(id, payload) =>
              edit.mutate(
                { messageId: id, ...payload },
                { onError: toastError },
              )
            }
            onDelete={(id) =>
              del.mutate(id, { onError: toastError })
            }
            onRetry={(msg) =>
              retry.mutate(msg, { onError: toastError })
            }
            onDiscard={discard}
            // The receipt rides ON the newest delivered message, so it can never
            // be separated from it by the row gap.
            footer={
              m.id === lastReal?.id ? (
                <SeenBy
                  workspaceId={workspace.id}
                  channelId={channelId}
                  compact={isDirect}
                  lastSeq={lastReal.seq}
                  lastAuthorId={lastReal.authorId}
                />
              ) : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}
