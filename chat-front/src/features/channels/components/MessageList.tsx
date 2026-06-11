import { useEffect, useRef } from "react";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "../realtime/message-cache";

/**
 * Scrollable message timeline. Renders optimistic ("sending") rows dimmed,
 * failed sends in red, edited rows tagged, and soft-deleted rows as a tombstone.
 * Auto-scrolls to the newest message.
 *
 * v1 shows a short author id; resolving display names (join to control.users) is
 * a follow-up.
 */
export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const { data: session } = useSession();
  const myId = session?.user.id;
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        No messages yet — say hello.
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-4">
      {messages.map((m) => (
        <div key={m.id} className={cn("text-sm", m.pending && "opacity-60")}>
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-foreground">
              {m.authorId === myId ? "You" : m.authorId.slice(0, 8)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            {m.version > 1 && !m.deleted && (
              <span className="text-[10px] text-muted-foreground">(edited)</span>
            )}
            {m.failed && <span className="text-[10px] text-destructive">failed to send</span>}
          </div>
          <div className={cn("whitespace-pre-wrap break-words text-foreground", m.deleted && "italic text-muted-foreground")}>
            {m.deleted ? "This message was deleted" : m.body}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
