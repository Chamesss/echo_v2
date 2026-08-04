import { useState } from "react";
import { Pencil, RotateCw, Trash2 } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AttachmentList } from "@/features/attachments/components/AttachmentList";
import { MessageEditor, type EditSavePayload } from "./MessageEditor";
import type { EchoMessage } from "../realtime/message-cache";

/**
 * A single message row. Display is presentational (author name/avatar resolved
 * upstream and passed in); edit/delete controls appear only for the caller's
 * own, non-deleted, non-pending messages. In edit mode it renders `MessageEditor`
 * (text + attachment keep/remove/add), which owns the upload hooks.
 */
export interface MessageRowProps {
  message: EchoMessage;
  isOwn: boolean;
  authorName: string;
  authorImage: string | null;
  /** Presence dot; `undefined` (the default) renders none. Resolved upstream. */
  authorOnline?: boolean;
  onEdit: (messageId: string, payload: EditSavePayload) => void;
  onDelete: (messageId: string) => void;
  /** Re-send a message whose POST failed (replays the same clientId). */
  onRetry?: (message: EchoMessage) => void;
  /** Drop a failed row from the timeline; local-only. */
  onDiscard?: (clientId: string) => void;
}

export function MessageRow({
  message,
  isOwn,
  authorName,
  authorImage,
  authorOnline,
  onEdit,
  onDelete,
  onRetry,
  onDiscard,
}: MessageRowProps) {
  const [editing, setEditing] = useState(false);

  // The author left the workspace → body withheld by the server (reversible).
  const unavailable = !message.deleted && message.authorActive === false;
  const canModify =
    isOwn && !message.deleted && !message.pending && !message.failed && !unavailable;

  return (
    // The negative inline margin lets the hover highlight bleed past the
    // timeline's own padding, so it reads as a full-width row (like Slack)
    // rather than a box floating inside the column.
    <div
      className={cn(
        "group -mx-2 flex gap-3 rounded-md px-2 py-[var(--density-row-y)] text-sm transition-colors hover:bg-accent/40",
        message.pending && "opacity-60",
      )}
    >
      <UserAvatar
        name={authorName}
        image={authorImage}
        className="mt-0.5 h-8 w-8"
        online={authorOnline}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-foreground">{authorName}</span>
          <span className="text-[10px] text-muted-foreground">
            {new Date(message.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {message.version > 1 && !message.deleted && !unavailable && (
            <span className="text-[10px] text-muted-foreground">(edited)</span>
          )}
          {message.failed && (
            <span className="flex items-center gap-1.5 text-[10px] text-destructive">
              failed to send
              {onRetry && (
                <button
                  type="button"
                  onClick={() => onRetry(message)}
                  className="inline-flex items-center gap-0.5 font-medium underline underline-offset-2 hover:no-underline"
                >
                  <RotateCw className="size-2.5" />
                  Retry
                </button>
              )}
              {onDiscard && (
                <button
                  type="button"
                  onClick={() => onDiscard(message.clientId)}
                  className="font-medium underline underline-offset-2 hover:no-underline"
                >
                  Discard
                </button>
              )}
            </span>
          )}

          {canModify && !editing && (
            <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5"
                aria-label="Edit message"
                title="Edit"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-destructive hover:text-destructive"
                aria-label="Delete message"
                title="Delete"
                onClick={() => {
                  if (window.confirm("Delete this message?")) onDelete(message.id);
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </span>
          )}
        </div>

        {editing ? (
          <MessageEditor
            message={message}
            onCancel={() => setEditing(false)}
            onSave={(payload) => {
              onEdit(message.id, payload);
              setEditing(false);
            }}
          />
        ) : (
          <>
            {/* Skip the text line for a file-only message (empty body). */}
            {(message.body || message.deleted || unavailable) && (
              <div
                className={cn(
                  "whitespace-pre-wrap break-words text-foreground",
                  (message.deleted || unavailable) && "italic text-muted-foreground",
                )}
              >
                {message.deleted
                  ? "This message was deleted"
                  : unavailable
                    ? "Message unavailable"
                    : message.body}
              </div>
            )}
            {!message.deleted && !unavailable && (
              <AttachmentList attachments={message.attachments ?? []} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
