import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { paths } from "@/lib/paths";
import { useSession } from "@/lib/auth-client";
import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";
import { useMembers } from "@/features/members/api/use-members";
import { useOpenDm } from "../api/use-dms";

/** Server cap on other participants — `openDmBody` in channels.dto.ts. */
const MAX_OTHERS = 9;

/**
 * "New message" modal: pick one workspace member for a 1:1, or several to start
 * a group conversation. Both reuse the normal channel route, so messaging works
 * immediately.
 *
 * A 1:1 is open-or-create — picking the same person twice always lands in the
 * same conversation. A group always creates a new one, because its members can
 * change and it can be renamed, so it isn't identified by who started in it.
 */
export function NewDmDialog({ onClose }: { onClose: () => void }) {
  const workspace = useCurrentWorkspace();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const { data: roster = [] } = useMembers(workspace.id);
  const openDm = useOpenDm(workspace.id);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const candidates = roster.filter((m) => m.userId !== session?.user.id);
  // Mirrors `openDmBody`'s `.max(9)`. Enforced here so hitting the ceiling
  // disables the remaining boxes rather than failing with a raw server error.
  const atCapacity = selected.size >= MAX_OTHERS;

  const toggle = (userId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else if (next.size < MAX_OTHERS) next.add(userId);
      return next;
    });

  const start = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    openDm.mutate(ids, {
      onSuccess: (dm) => {
        onClose();
        navigate(paths.workspaceChannel(workspace.id, dm.id));
      },
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="New direct message"
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <h2 className="font-semibold text-foreground">
            {selected.size > 1 ? "New group conversation" : "New message"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="overflow-y-auto p-2">
          {candidates.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No one else is in this workspace yet.</p>
          ) : (
            <>
              {/* Multi-select was already supported and completely unadvertised,
                  so group conversations were effectively undiscoverable. */}
              <p className="px-3 pb-1 pt-2 text-xs text-muted-foreground">
                Pick one person, or several to start a group.
              </p>
              {candidates.map((m) => {
                const checked = selected.has(m.userId);
                const disabled = !checked && atCapacity;
                return (
                  <label
                    key={m.userId}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm",
                      disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-accent",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggle(m.userId)}
                    />
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-foreground">{m.name}</span>{" "}
                      <span className="text-muted-foreground">{m.email}</span>
                    </span>
                  </label>
                );
              })}
            </>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border p-3">
          <span className="mr-auto text-xs text-muted-foreground">
            {selected.size === 0
              ? "Pick people"
              : atCapacity
                ? `${selected.size} selected (max)`
                : `${selected.size} selected`}
          </span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={selected.size === 0 || openDm.isPending} onClick={start}>
            {openDm.isPending ? "Opening…" : "Start"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
