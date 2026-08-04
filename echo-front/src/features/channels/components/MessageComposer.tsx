import { useRef, useState } from "react";
import { toast } from "sonner";
import { Paperclip, SendHorizontal } from "lucide-react";
import type { AttachmentWire } from "@server/infrastructure/realtime/protocol";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth-client";
import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";
import { useAttachmentUploads } from "@/features/attachments/api/use-upload-attachment";
import { AttachmentPreviewTile } from "@/features/attachments/components/AttachmentPreviewTile";
import { useSendMessage } from "../api/use-messages";
import { useTypingEmitter } from "../realtime/use-typing";

const MAX_TEXTAREA_PX = 200;

/**
 * Message input with attachments — a single cohesive control: an attachment
 * preview tray, an auto-growing textarea, and a toolbar (attach left, send
 * right). Sends optimistically and clears immediately; Enter sends, Shift+Enter
 * adds a newline. Files upload on pick/drop; send is blocked until uploads
 * settle, and a file-only message (no text) is allowed.
 */
export function MessageComposer({ channelId }: { channelId: string }) {
  const workspace = useCurrentWorkspace();
  const { data: session } = useSession();
  const send = useSendMessage(workspace.id, channelId, session?.user.id ?? "");
  const uploads = useAttachmentUploads(workspace.id, channelId);
  const typing = useTypingEmitter(channelId);
  const [body, setBody] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const canSend = !uploads.hasUploading && (body.trim().length > 0 || uploads.doneItems.length > 0);

  const autoGrow = () => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  };

  const submit = () => {
    if (!canSend) return;
    // Local object-URL previews for the optimistic row — the uploaded object is
    // private, so its real URL (our signed-redirect pointer) arrives with the
    // server message, which replaces this row by clientId. Track them so we can
    // revoke once the send settles (avoids a leaked/dead `blob:` URL).
    const blobUrls: string[] = [];
    const optimisticAttachments: AttachmentWire[] = uploads.doneItems.map((it) => {
      const url = URL.createObjectURL(it.file);
      blobUrls.push(url);
      return {
        id: it.id,
        filename: it.file.name,
        contentType: it.file.type || "application/octet-stream",
        size: it.file.size,
        category: it.category ?? "file",
        url,
      };
    });
    const attachments = uploads.doneItems.map((it) => ({ key: it.key!, filename: it.file.name }));

    setBody("");
    uploads.clear();
    typing.stop(); // clear everyone else's indicator now, not after their TTL
    if (textRef.current) textRef.current.style.height = "auto";
    const sentBody = body.trim();
    send.mutate(
      { body: sentBody, attachments, optimisticAttachments },
      {
        onError: (err) => {
          toast.error(err.message);
          // Put the text back so a failed send doesn't eat what they wrote. Only
          // when the box is still empty — if they've started a new message,
          // clobbering it would be worse than the loss. The failed row keeps its
          // own copy either way, and can be retried from there.
          setBody((current) => (current.trim() ? current : sentBody));
        },
        // The optimistic row has been swapped for the server row (stable proxy
        // URLs) on success, or marked failed on error — either way the blobs are
        // no longer referenced, so reclaim them.
        onSettled: () => blobUrls.forEach((u) => URL.revokeObjectURL(u)),
      },
    );
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length) uploads.addFiles(files);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) uploads.addFiles(files);
  };

  return (
    <div className="px-4 pb-4 pt-1">
      <div
        className={cn(
          "rounded-2xl border bg-background shadow-sm transition focus-within:ring-1 focus-within:ring-ring",
          dragging ? "border-primary ring-2 ring-primary/40" : "border-border",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {uploads.items.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-border p-3">
            {uploads.items.map((it) => (
              <AttachmentPreviewTile
                key={it.id}
                file={it.file}
                isImage={(it.file.type || "").startsWith("image/")}
                filename={it.file.name}
                size={it.file.size}
                progress={it.status === "uploading" ? it.progress : undefined}
                error={it.status === "error" ? (it.error ?? "Upload failed") : undefined}
                onRemove={() => uploads.remove(it.id)}
              />
            ))}
          </div>
        )}

        <textarea
          ref={textRef}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            autoGrow();
            // Emptying the box is a stop signal — otherwise deleting a draft
            // leaves you "typing" for the rest of the receivers' TTL.
            if (e.target.value.trim()) typing.onInput();
            else typing.stop();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={dragging ? "Drop files to attach…" : "Message"}
          className="block max-h-52 w-full resize-none bg-transparent px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none"
        />

        <div className="flex items-center justify-between px-2 pb-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            aria-label="Attach files"
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip className="size-4" />
          </Button>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={onPick} />

          <Button
            type="button"
            size="icon"
            className="size-8 rounded-full"
            aria-label="Send message"
            onClick={submit}
            disabled={!canSend}
          >
            <SendHorizontal className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
