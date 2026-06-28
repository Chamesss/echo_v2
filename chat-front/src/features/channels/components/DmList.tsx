import { useState } from "react";
import { NavLink } from "react-router";
import { MessageSquare, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { paths } from "@/lib/paths";
import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";
import { useDirectMessages } from "../api/use-dms";
import { NewDmDialog } from "./NewDmDialog";

/**
 * Sidebar "Direct messages" section for the active workspace. Lists the
 * caller's DMs (labelled with the other participants) with unread badges; the
 * "+" opens the new-message picker.
 */
export function DmList() {
  const workspace = useCurrentWorkspace();
  const { data: dms = [], isPending } = useDirectMessages(workspace.id);
  const [picking, setPicking] = useState(false);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Direct messages
        </span>
        <button
          type="button"
          onClick={() => setPicking(true)}
          aria-label="New direct message"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <Plus className="size-4" />
        </button>
      </div>

      {isPending ? (
        <p className="px-2 text-xs text-muted-foreground">Loading…</p>
      ) : dms.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">
          No direct messages.
        </p>
      ) : (
        dms.map((dm) => (
          <NavLink
            key={dm.id}
            to={paths.workspaceChannel(workspace.id, dm.id)}
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
                <MessageSquare className="size-4 shrink-0" />
                <span className="truncate">{dm.name || "Direct message"}</span>
                {/* No badge for the DM you're viewing — it has no unread to you. */}
                {dm.unread > 0 && !isActive && (
                  <span className="ml-auto h-4 w-4 text-center rounded-full bg-foreground px-1 text-[10px] font-semibold text-background">
                    {dm.unread}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))
      )}

      {picking && <NewDmDialog onClose={() => setPicking(false)} />}
    </div>
  );
}
