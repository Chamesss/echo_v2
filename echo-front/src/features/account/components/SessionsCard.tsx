import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { Laptop, LogOut, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { useRevokeOtherSessions, useRevokeSession, useSessions } from "../api/use-sessions";

/**
 * Active-sessions list with per-row revoke + global "sign out everywhere else".
 *
 * Pulled from Better Auth's `listSessions`. The current session row gets
 * a "this device" badge and the revoke button is suppressed for it — the
 * user signs out their current device via the sidebar's Sign out button,
 * not from here.
 */
export function SessionsCard() {
  const { data: session } = useSession();
  const { data: sessions = [], isPending } = useSessions();
  const revokeOne = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();

  const currentToken = session?.session.token;

  const handleRevokeOne = (token: string) => {
    revokeOne.mutate(token, {
      onSuccess: () => toast.success("Session revoked"),
      onError: toastError,
    });
  };

  const handleRevokeOthers = () => {
    revokeOthers.mutate(undefined, {
      onSuccess: () => toast.success("Signed out from all other devices"),
      onError: toastError,
    });
  };

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Loading sessions…</p>;
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-md border border-border">
        {sessions.map((s) => {
          const isCurrent = s.token === currentToken;
          return (
            <li key={s.id} className="flex items-center justify-between gap-3 p-3">
              <div className="flex min-w-0 items-center gap-3">
                <DeviceIcon userAgent={s.userAgent ?? null} />
                <div className="min-w-0 text-sm">
                  <div className="truncate font-medium text-foreground">
                    {summarize(s.userAgent ?? null)}
                    {isCurrent && (
                      <span className="ml-2 rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground">
                        This device
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {s.ipAddress ?? "Unknown IP"} ·{" "}
                    {new Date(s.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
              {!isCurrent && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={revokeOne.isPending}
                  onClick={() => handleRevokeOne(s.token)}
                >
                  <LogOut /> Revoke
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="border-t border-border pt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={handleRevokeOthers}
          disabled={revokeOthers.isPending || sessions.length <= 1}
        >
          {revokeOthers.isPending ? "Signing out…" : "Sign out everywhere else"}
        </Button>
      </div>
    </div>
  );
}

function DeviceIcon({ userAgent }: { userAgent: string | null }) {
  const isMobile = userAgent && /Mobile|Android|iPhone|iPad/.test(userAgent);
  const Icon = isMobile ? Smartphone : Laptop;
  return <Icon className="size-4 shrink-0 text-muted-foreground" />;
}

function summarize(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  // Cheap UA classification — good enough for the list, no UA parser library.
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return "Android device";
  if (/Chrome/.test(userAgent)) return "Chrome";
  if (/Safari/.test(userAgent)) return "Safari";
  if (/Firefox/.test(userAgent)) return "Firefox";
  return "Browser";
}
