import { useEffect, useState } from "react";
import { Loader2, WifiOff } from "lucide-react";
import type { RealtimeStatus } from "@/lib/reconnecting-socket";
import { useRealtime } from "@/features/channels/realtime/realtime-context";
import { useUserRealtimeStatus } from "@/features/notifications/realtime/notifications-provider";

/**
 * Routine reconnects are fast (a page refresh, a brief blip), so showing the
 * banner instantly would make it flicker on healthy connections. Wait long
 * enough that only a genuine interruption surfaces.
 */
const SHOW_AFTER_MS = 1_000;

/**
 * The one visible signal that realtime has stopped working.
 *
 * Without it, every failure in the realtime layer looks identical to the user:
 * nothing happens. Messages stop arriving, typing indicators die, and — because
 * sending goes over REST, not the socket — sends keep succeeding, so there is no
 * natural moment where the app admits something is wrong.
 *
 * Reflects the WORSE of the two sockets: the workspace socket carries the
 * message timeline, the awareness socket carries unread counts and
 * notifications, and either being down means the user is missing updates.
 */
export function ConnectionBanner() {
  const { status: workspaceStatus, client } = useRealtime();
  const { status: userStatus, restart: restartUser } = useUserRealtimeStatus();

  const status = worseOf(workspaceStatus, userStatus);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (status === "open") {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [status]);

  if (!visible || status === "open") return null;

  const terminal = status === "stopped";

  const handleReconnect = () => {
    if (workspaceStatus === "stopped") client.restart();
    if (userStatus === "stopped") restartUser();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        "flex shrink-0 items-center justify-center gap-2 border-b px-3 py-1.5 text-xs " +
        (terminal
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400")
      }
    >
      {terminal ? (
        <WifiOff className="size-3.5 shrink-0" />
      ) : (
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
      )}
      <span>
        {terminal
          ? "Disconnected. Live updates are paused."
          : "Reconnecting… messages may be delayed."}
      </span>
      {terminal && (
        <button
          type="button"
          onClick={handleReconnect}
          className="font-medium underline underline-offset-2 hover:no-underline"
        >
          Reconnect
        </button>
      )}
    </div>
  );
}

/** "stopped" is worse than "connecting"/"closed", which are worse than "open". */
function worseOf(a: RealtimeStatus, b: RealtimeStatus): RealtimeStatus {
  const rank = (s: RealtimeStatus) => (s === "open" ? 0 : s === "stopped" ? 2 : 1);
  return rank(a) >= rank(b) ? a : b;
}
