import { useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import type { AttachmentWire } from "@server/infrastructure/realtime/protocol";
import { Button } from "@/components/ui/button";
import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";
import { useAttachmentUploads } from "@/features/attachments/api/use-upload-attachment";
import { AttachmentPreviewTile } from "@/features/attachments/components/AttachmentPreviewTile";
import type { EchoMessage } from "../realtime/message-cache";

export interface EditSavePayload {
  body: string;
  /** Existing attachment ids to keep. */
  keepAttachmentIds: string[];
  /** Newly-uploaded refs to add. */
  attachments: { key: string; filename: string }[];
}

const MAX_TEXTAREA_PX = 240;

/**
 * Inline message editor (Slack/GitHub-style): edit the text, remove individual
 * existing attachments, and add new files — then save. Existing files are kept
 * by id; new files upload via the shared attachment hook. Save is blocked while
 * an upload is in flight, and a message can't be saved empty (text or ≥1 file).
 */
export function MessageEditor({
  message,
  onSave,
  onCancel,
}: {
  message: EchoMessage;
  onSave: (payload: EditSavePayload) => void;
  onCancel: () => void;
}) {
  const workspace = useCurrentWorkspace();
  const uploads = useAttachmentUploads(workspace.id, message.channelId);
  const [body, setBody] = useState(message.body);
  const [kept, setKept] = useState<AttachmentWire[]>(message.attachments ?? []);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const total = kept.length + uploads.doneItems.length;
  const canSave = !uploads.hasUploading && (body.trim().length > 0 || total > 0);
  const hasTray = kept.length > 0 || uploads.items.length > 0;

  const autoGrow = () => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  };

  const save = () => {
    if (!canSave) return;
    onSave({
      body: body.trim(),
      keepAttachmentIds: kept.map((a) => a.id),
      attachments: uploads.doneItems.map((it) => ({ key: it.key!, filename: it.file.name })),
    });
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length) uploads.addFiles(files);
  };

  return (
    <div className="mt-1 space-y-2">
      <div className="rounded-xl border border-border bg-background focus-within:ring-1 focus-within:ring-ring">
        {hasTray && (
          <div className="flex flex-wrap gap-2 border-b border-border p-2.5">
            {kept.map((a) => (
              <AttachmentPreviewTile
                key={a.id}
                url={a.url}
                isImage={a.category === "image"}
                filename={a.filename}
                size={a.size}
                onRemove={() => setKept((cur) => cur.filter((x) => x.id !== a.id))}
              />
            ))}
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
          autoFocus
          onChange={(e) => {
            setBody(e.target.value);
            autoGrow();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") onCancel();
          }}
          rows={1}
          placeholder="Edit message"
          className="block max-h-60 w-full resize-none bg-transparent px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none"
        />

        <div className="flex items-center px-1.5 pb-1.5">
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
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={!canSave}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <span className="text-[11px] text-muted-foreground">
          Enter to save · Esc to cancel
        </span>
      </div>
    </div>
  );
}
