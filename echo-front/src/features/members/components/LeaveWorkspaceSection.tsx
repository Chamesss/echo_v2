import { useNavigate } from "react-router";
import { toast } from "sonner";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { paths } from "@/lib/paths";
import { clearLastWorkspaceId } from "@/lib/local-storage";
import { useLeaveWorkspace } from "../api/use-members";

/**
 * Leave-workspace action. Shown only to non-owner members (the owner can't
 * leave — the server rejects it too). On success we forget the last-workspace
 * pointer and bounce to "/", which re-resolves to another workspace or the
 * create page.
 */
export function LeaveWorkspaceSection({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const leave = useLeaveWorkspace(workspaceId);

  const handleLeave = () => {
    if (!window.confirm("Leave this workspace? You'll lose access to its channels.")) return;
    leave.mutate(undefined, {
      onSuccess: () => {
        clearLastWorkspaceId();
        toast.success("You left the workspace");
        navigate(paths.home);
      },
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        Remove yourself from this workspace. You can be re-invited later.
      </p>
      <Button variant="destructive" disabled={leave.isPending} onClick={handleLeave}>
        <LogOut /> {leave.isPending ? "Leaving…" : "Leave workspace"}
      </Button>
    </div>
  );
}
