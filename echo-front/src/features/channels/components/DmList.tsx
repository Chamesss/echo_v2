import { useState } from "react";
import { NavLink } from "react-router";
import { MessageSquare, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { paths } from "@/lib/paths";
import { useSession } from "@/lib/auth-client";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";
import { usePresence } from "@/features/members/api/use-presence";
import { useDirectMessages } from "../api/use-dms";
import { NewDmDialog } from "./NewDmDialog";

/**
 * Sidebar "Direct messages" section for the active workspace. Lists the
 * caller's DMs (labelled with the other participants) with unread badges; the
 * "+" opens the new-message picker.
 */
export function DmList() {
  const workspace = useCurrentWorkspace();
  const { data: session } = useSession();
  const { data: dms = [], isPending } = useDirectMessages(workspace.id);
  const { data: online } = usePresence(workspace.id);
  const [picking, setPicking] = useState(false);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-sidebar-muted-foreground">
          Direct messages
        </span>
        <button
          type="button"
          onClick={() => setPicking(true)}
          aria-label="New direct message"
          className="rounded p-1 text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Plus className="size-4" />
        </button>
      </div>

      {isPending ? (
        <p className="px-2 text-xs text-sidebar-muted-foreground">Loading…</p>
      ) : dms.length === 0 ? (
        <p className="px-2 text-xs text-sidebar-muted-foreground">
          No direct messages.
        </p>
      ) : (
        dms.map((dm) => {
          // Wait for the session before deciding who "the others" are. While
          // `session?.user.id` is undefined YOU count as another participant,
          // so a 1:1 briefly looks like a group and loses its avatar.
          const myId = session?.user.id;
          const others = myId
            ? dm.participants.filter((p) => p.userId !== myId)
            : [];
          // A 1:1 has exactly one other person → their face, and their status.
          // A group shows a small stack instead: presence doesn't collapse into
          // one dot, but faces are still more recognisable than a generic glyph.
          const solo = others.length === 1 ? others[0]! : null;
          const stack = others.slice(0, 3);
          return (
          <NavLink
            key={dm.id}
            to={paths.workspaceChannel(workspace.id, dm.id)}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-2 py-[var(--density-row-y)] text-sm",
                isActive
                  ? "bg-sidebar-active font-medium text-sidebar-active-foreground"
                  : "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )
            }
          >
            {({ isActive }) => (
              <>
                {solo ? (
                  <UserAvatar
                    name={solo.name}
                    image={solo.image}
                    className="size-6"
                    maxInitials={1}
                    online={online ? online.has(solo.userId) : undefined}
                  />
                ) : stack.length > 0 ? (
                  <span className="flex shrink-0 -space-x-2">
                    {stack.map((p) => (
                      <UserAvatar
                        key={p.userId}
                        name={p.name}
                        image={p.image}
                        className="size-6 ring-1 ring-sidebar"
                        maxInitials={1}
                      />
                    ))}
                  </span>
                ) : (
                  <MessageSquare className="size-4 shrink-0" />
                )}
                <span className="truncate">{dm.name || "Direct message"}</span>
                {others.length > 1 && (
                  <span className="shrink-0 text-[10px] text-sidebar-muted-foreground">
                    {dm.participants.length}
                  </span>
                )}
                {/* No badge for the DM you're viewing — it has no unread to you. */}
                {dm.unread > 0 && !isActive && (
                  <span className="ml-auto h-4 w-4 text-center rounded-full bg-sidebar-badge px-1 text-[10px] font-semibold text-sidebar-badge-foreground">
                    {dm.unread}
                  </span>
                )}
              </>
            )}
          </NavLink>
          );
        })
      )}

      {picking && <NewDmDialog onClose={() => setPicking(false)} />}
    </div>
  );
}
