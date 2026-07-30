import { Download, FileText } from "lucide-react";
import type { AttachmentWire } from "@server/infrastructure/realtime/protocol";
import { Image } from "@/components/ui/image";
import { formatBytes } from "../api/use-attachment-policy";

/**
 * Renders a message's attachments by category: images inline (click to open),
 * video/audio as native players, everything else as a download chip. `file`
 * (unknown/active-content) is deliberately never rendered inline — the server
 * also stored it `Content-Disposition: attachment`.
 *
 * Sizing: every item caps at `max-w-xs` (20rem) from `sm` up, but only at
 * `max-w-full` below it. On a phone the message column is narrower than 20rem —
 * the avatar, the row padding and the timeline's own padding all come out of it
 * — so a flat 20rem cap let media hang past the column and gave the whole
 * channel a horizontal scrollbar. A percentage cap can't, since it resolves
 * against whatever width the column actually has.
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
      // The cap lives on the ANCHOR, not the image: `w-fit` shrink-wraps to the
      // image, so a pixel max-width on the image would size the anchor to that
      // pixel width and let both overhang a narrower column. Capping the anchor
      // and letting the image ride `max-w-full` keeps the link box glued to the
      // image at every width (no dead click area beside a small one).
      <a
        href={a.url}
        target="_blank"
        rel="noreferrer"
        className="block w-fit max-w-full sm:max-w-xs"
      >
        <Image
          src={a.url}
          alt={a.filename}
          className="max-h-72 max-w-full rounded-md border border-border object-cover"
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
        className="max-h-72 max-w-full rounded-md border border-border sm:max-w-xs"
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
      className="flex w-fit max-w-full items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm hover:bg-accent sm:max-w-xs"
    >
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{a.filename}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(a.size)}</span>
      <Download className="size-3.5 shrink-0 text-muted-foreground" />
    </a>
  );
}
