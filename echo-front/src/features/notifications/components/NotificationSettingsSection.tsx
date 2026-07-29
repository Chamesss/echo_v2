import { toast } from "sonner";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useNotificationSettings,
  useSetNotificationSettings,
} from "../api/use-notifications";

/**
 * Per-workspace notification toggle (the caller's own preference). When off, the
 * bell + toasts are silenced for this workspace; unread counts still work.
 * Rendered on the workspace-settings page for every member.
 */
export function NotificationSettingsSection({ workspaceId }: { workspaceId: string }) {
  const { data: enabled, isPending } = useNotificationSettings(workspaceId);
  const setEnabled = useSetNotificationSettings(workspaceId);

  const toggle = (next: boolean) =>
    setEnabled.mutate(next, {
      onError: (err) => toast.error(err.message),
    });

  const on = enabled ?? true;

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-muted-foreground">
          {on ? <Bell className="size-5" /> : <BellOff className="size-5" />}
        </span>
        <div className="text-sm">
          <div className="font-medium text-foreground">Notifications</div>
          <p className="text-muted-foreground">
            {on
              ? "You'll get the bell + a toast for new messages here."
              : "Silenced — no bell or toast for this workspace (unread counts still show)."}
          </p>
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant={on ? "outline" : "default"}
        disabled={isPending || setEnabled.isPending}
        onClick={() => toggle(!on)}
        className={cn("shrink-0", isPending && "opacity-50")}
      >
        {on ? "Disable" : "Enable"}
      </Button>
    </div>
  );
}
