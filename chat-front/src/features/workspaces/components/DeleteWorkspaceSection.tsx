import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { paths } from "@/lib/paths";
import { clearLastWorkspaceId } from "@/lib/local-storage";
import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";
import { useDeleteWorkspace } from "../api/use-delete-workspace";

/**
 * Permanently delete the workspace. Owner-only (the server enforces it too).
 * Irreversible — takes every channel, message, member, and pending invite with
 * it — so we require typing the slug to confirm.
 */
export function DeleteWorkspaceSection() {
  const workspace = useCurrentWorkspace();
  const navigate = useNavigate();
  const del = useDeleteWorkspace(workspace.id);

  const handleDelete = () => {
    const typed = window.prompt(
      `This permanently deletes "${workspace.name}" and all its channels and messages.\n\nType the workspace slug "${workspace.slug}" to confirm:`,
    );
    if (typed === null) return; // cancelled
    if (typed.trim() !== workspace.slug) {
      toast.error("That didn't match the slug — deletion cancelled");
      return;
    }
    del.mutate(undefined, {
      onSuccess: () => {
        clearLastWorkspaceId();
        toast.success("Workspace deleted");
        navigate(paths.home);
      },
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        Permanently delete this workspace and everything in it. This can't be undone.
      </p>
      <Button variant="destructive" disabled={del.isPending} onClick={handleDelete}>
        <Trash2 /> {del.isPending ? "Deleting…" : "Delete workspace"}
      </Button>
    </div>
  );
}
