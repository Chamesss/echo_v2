import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { paths } from "@/lib/paths";
import { useSession } from "@/lib/auth-client";
import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";
import { useMembers } from "@/features/members/api/use-members";
import { useOpenDm } from "../api/use-dms";

/**
 * "New direct message" modal: pick one workspace member (1:1) or several
 * (group), then open-or-create the DM and navigate to it. The DM channel reuses
 * the normal channel route, so messaging works immediately.
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

  const toggle = (userId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
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
          <h2 className="font-semibold text-foreground">New message</h2>
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
            candidates.map((m) => (
              <label
                key={m.userId}
                className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={selected.has(m.userId)}
                  onChange={() => toggle(m.userId)}
                />
                <span className="min-w-0 truncate">
                  <span className="font-medium text-foreground">{m.name}</span>{" "}
                  <span className="text-muted-foreground">{m.email}</span>
                </span>
              </label>
            ))
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border p-3">
          <span className="mr-auto text-xs text-muted-foreground">
            {selected.size === 0 ? "Pick people" : `${selected.size} selected`}
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
