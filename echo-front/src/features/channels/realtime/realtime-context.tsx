import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { WorkspaceRealtime, type RealtimeStatus } from "@/lib/realtime";

/**
 * Owns the single `WorkspaceRealtime` connection for the active workspace and
 * exposes it (plus a connection status for UI indicators) to the channel hooks.
 *
 * Mounted with `key={workspaceId}` by `WorkspaceLayout`, so switching workspaces
 * tears the old socket down and spins up a fresh one. The reconciliation hooks
 * (`useChannelStream`) consume `client` to subscribe and to react to reconnects.
 */
interface RealtimeContextValue {
  client: WorkspaceRealtime;
  status: RealtimeStatus;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  const [client] = useState(() => new WorkspaceRealtime(workspaceId));
  const [status, setStatus] = useState<RealtimeStatus>("connecting");

  useEffect(() => {
    const off = client.onStatus((s) => setStatus(s));
    client.connect();
    return () => {
      off();
      client.close();
    };
  }, [client]);

  return (
    <RealtimeContext.Provider value={{ client, status }}>{children}</RealtimeContext.Provider>
  );
}

export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error("useRealtime must be used within a RealtimeProvider");
  return ctx;
}
