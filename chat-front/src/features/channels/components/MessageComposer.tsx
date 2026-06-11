import { useState } from "react";
import { toast } from "sonner";
import { SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";
import { useSendMessage } from "../api/use-messages";

/**
 * Message input. Sends optimistically (the row appears instantly via
 * `useSendMessage`) and clears the field immediately; Enter sends, Shift+Enter
 * inserts a newline.
 */
export function MessageComposer({ channelId }: { channelId: string }) {
  const workspace = useCurrentWorkspace();
  const { data: session } = useSession();
  const send = useSendMessage(workspace.id, channelId, session?.user.id ?? "");
  const [body, setBody] = useState("");

  const submit = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    setBody("");
    send.mutate({ body: trimmed }, { onError: (err) => toast.error(err.message) });
  };

  return (
    <div className="border-t border-border p-3">
      <div className="flex items-end gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="Message"
          className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <Button type="button" size="sm" onClick={submit} disabled={!body.trim()}>
          <SendHorizontal className="size-4" />
        </Button>
      </div>
    </div>
  );
}
