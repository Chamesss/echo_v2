import { useEffect, useState } from "react";
import { FileText, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes } from "../api/use-attachment-policy";

/**
 * A single attachment preview used in the composer + editor trays: a square
 * thumbnail for images, a compact file card otherwise, with an upload-progress
 * overlay, error state, and a hover-reveal remove button. Owns the object-URL
 * lifecycle for local (not-yet-uploaded) image previews.
 */
export function AttachmentPreviewTile({
  file,
  url,
  isImage,
  filename,
  size,
  progress,
  error,
  onRemove,
}: {
  /** Local file (pending upload) — used for an instant image preview. */
  file?: File;
  /** Remote URL (already-uploaded image). */
  url?: string | null;
  isImage: boolean;
  filename: string;
  size?: number;
  /** 0–100 while uploading; omit when not uploading. */
  progress?: number;
  error?: string;
  onRemove: () => void;
}) {
  // Create AND revoke the local preview URL in the SAME effect. Creating it in
  // useMemo and revoking in a separate effect breaks under React StrictMode (dev),
  // which runs effects setup→cleanup→setup without re-running the memo: the
  // cleanup revokes the only URL we have, leaving a dead `blob:` → ERR_FILE_NOT_FOUND.
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!(file && isImage)) {
      setObjectUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setObjectUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file, isImage]);

  const src = objectUrl ?? url ?? null;
  const uploading = progress !== undefined && progress < 100 && !error;

  return (
    <div
      className={cn(
        "group/tile relative shrink-0 overflow-hidden rounded-lg border bg-muted/40",
        error ? "border-destructive/50" : "border-border",
        isImage ? "size-20" : "w-56",
      )}
    >
      <button
        type="button"
        aria-label={`Remove ${filename}`}
        onClick={onRemove}
        className="absolute right-1 top-1 z-10 rounded-full bg-background/90 p-1 text-muted-foreground opacity-0 shadow-sm ring-1 ring-border transition group-hover/tile:opacity-100 hover:text-foreground"
      >
        <X className="size-3" />
      </button>

      {isImage && src ? (
        <img src={src} alt={filename} title={filename} className="size-20 object-cover" />
      ) : (
        <div className="flex h-14 items-center gap-2.5 p-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
            <FileText className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium text-foreground" title={filename}>
              {filename}
            </span>
            <span className={cn("block text-[11px]", error ? "text-destructive" : "text-muted-foreground")}>
              {error ?? (size !== undefined ? formatBytes(size) : "")}
            </span>
          </span>
        </div>
      )}

      {uploading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-[1px]">
          <span className="flex items-center gap-1 text-xs font-medium text-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {progress}%
          </span>
        </div>
      )}

      {error && isImage && (
        <div className="absolute inset-0 flex items-center justify-center bg-destructive/15 p-1 text-center text-[10px] font-medium text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
