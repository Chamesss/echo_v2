import { Download, FileText } from "lucide-react";
import type { AttachmentWire } from "@server/infrastructure/realtime/protocol";
import { Image } from "@/components/ui/image";
import { formatBytes } from "../api/use-attachment-policy";

/**
 * Renders a message's attachments by category: images inline (click to open),
 * video/audio as native players, everything else as a download chip. `file`
 * (unknown/active-content) is deliberately never rendered inline — the server
 * also stored it `Content-Disposition: attachment`.
 */
export function AttachmentList({ attachments }: { attachments: AttachmentWire[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-2">
      {attachments.map((a) => (
        <AttachmentItem key={a.id} attachment={a} />
      ))}
    </div>
  );
}

function AttachmentItem({ attachment: a }: { attachment: AttachmentWire }) {
  if (a.category === "image") {
    return (
      <a href={a.url} target="_blank" rel="noreferrer" className="block w-fit">
        <Image
          src={a.url}
          alt={a.filename}
          className="max-h-72 max-w-xs rounded-md border border-border object-cover"
          fallback={
            <span className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              <FileText className="size-4 shrink-0" />
              <span className="truncate">{a.filename}</span>
            </span>
          }
        />
      </a>
    );
  }
  if (a.category === "video") {
    return (
      <video
        src={a.url}
        controls
        className="max-h-72 max-w-xs rounded-md border border-border"
      />
    );
  }
  if (a.category === "audio") {
    return <audio src={a.url} controls className="w-64 max-w-full" />;
  }
  // document / file → download chip
  return (
    <a
      href={a.url}
      target="_blank"
      rel="noreferrer"
      download={a.filename}
      className="flex w-fit max-w-xs items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm hover:bg-accent"
    >
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{a.filename}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(a.size)}</span>
      <Download className="size-3.5 shrink-0 text-muted-foreground" />
    </a>
  );
}
