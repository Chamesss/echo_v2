import { useState } from "react";
import { NavLink } from "react-router";
import { toast } from "sonner";
import { Hash, Lock, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { paths } from "@/lib/paths";
import { Input } from "@/components/ui/input";
import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";
import { useChannels, useCreateChannel } from "../api/use-channels";

/**
 * Sidebar channel list for the active workspace. Replaces the old "Channels
 * (soon)" placeholder. Each row links to the channel route and shows an unread
 * badge; the "+" reveals an inline create field (public channel for v1).
 */
export function ChannelList() {
  const workspace = useCurrentWorkspace();
  const { data: channels = [], isPending } = useChannels(workspace.id);
  const createChannel = useCreateChannel(workspace.id);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    createChannel.mutate(
      { type: "public", name: trimmed },
      {
        onSuccess: () => {
          setName("");
          setCreating(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Channels
        </span>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          aria-label="New channel"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <Plus className="size-4" />
        </button>
      </div>

      {creating && (
        <div className="px-2 pb-1">
          <Input
            autoFocus
            value={name}
            placeholder="new-channel"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setCreating(false);
            }}
            disabled={createChannel.isPending}
            className="h-8"
          />
        </div>
      )}

      {isPending ? (
        <p className="px-2 text-xs text-muted-foreground">Loading…</p>
      ) : channels.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">No channels yet.</p>
      ) : (
        channels.map((channel) => (
          <NavLink
            key={channel.id}
            to={paths.workspaceChannel(workspace.id, channel.id)}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )
            }
          >
            {({ isActive }) => (
              <>
                {channel.type === "private" ? (
                  <Lock className="size-4 shrink-0" />
                ) : (
                  <Hash className="size-4 shrink-0" />
                )}
                <span className="truncate">{channel.name}</span>
                {/* No badge for the channel you're viewing — it has no unread to you. */}
                {channel.unread > 0 && !isActive && (
                  <span className="ml-auto h-4 w-4 text-center rounded-full bg-foreground px-1 text-[10px] font-semibold text-background">
                    {channel.unread}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))
      )}
    </div>
  );
}
