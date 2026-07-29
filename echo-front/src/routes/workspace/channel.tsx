import { useParams } from "react-router";
import { ChannelView } from "@/features/channels/components/ChannelView";

/**
 * Channel route (`/dashboard/:workspaceId/channels/:channelId`), rendered inside
 * the workspace shell's `<Outlet/>`. Thin wrapper — all logic is in `ChannelView`.
 */
export default function ChannelPage() {
  const { channelId } = useParams<{ channelId: string }>();
  if (!channelId) return null;
  // Remount the view (and its realtime subscription) when the channel changes.
  return <ChannelView key={channelId} channelId={channelId} />;
}
