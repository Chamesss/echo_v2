import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AttachmentList } from "@/features/attachments/components/AttachmentList";
import { MessageEditor, type EditSavePayload } from "./MessageEditor";
import type { ChatMessage } from "../realtime/message-cache";

/**
 * A single message row. Display is presentational (author name/avatar resolved
 * upstream and passed in); edit/delete controls appear only for the caller's
 * own, non-deleted, non-pending messages. In edit mode it renders `MessageEditor`
 * (text + attachment keep/remove/add), which owns the upload hooks.
 */
export interface MessageRowProps {
  message: ChatMessage;
  isOwn: boolean;
  authorName: string;
  authorImage: string | null;
  onEdit: (messageId: string, payload: EditSavePayload) => void;
  onDelete: (messageId: string) => void;
}

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function MessageRow({ message, isOwn, authorName, authorImage, onEdit, onDelete }: MessageRowProps) {
  const [editing, setEditing] = useState(false);

  // The author left the workspace → body withheld by the server (reversible).
  const unavailable = !message.deleted && message.authorActive === false;
  const canModify =
    isOwn && !message.deleted && !message.pending && !message.failed && !unavailable;

  return (
    <div className={cn("group flex gap-3 text-sm", message.pending && "opacity-60")}>
      <Avatar className="mt-0.5 h-8 w-8">
        {authorImage && <AvatarImage src={authorImage} alt={authorName} />}
        <AvatarFallback>{initials(authorName)}</AvatarFallback>
      </Avatar>

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
          {message.failed && <span className="text-[10px] text-destructive">failed to send</span>}

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
