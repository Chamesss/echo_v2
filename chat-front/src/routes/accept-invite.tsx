import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/auth-layout";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { paths } from "@/lib/paths";
import { setLastWorkspaceId } from "@/lib/local-storage";
import { useAcceptInvite, useInvite } from "@/features/members/api/use-invite";

/**
 * Invite acceptance landing page at `/accept-invite/:token`.
 *
 * Authed (via RequireAuth) but NOT inside the workspace shell — the visitor
 * isn't a member yet. We resolve the invite, then let the signed-in user accept
 * if it's still valid and addressed to their email; on success we drop them into
 * the workspace. Expired/used/unknown invites get a clear dead-end message.
 */
export default function AcceptInvitePage() {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { data: invite, isPending, error } = useInvite(token);
  const accept = useAcceptInvite(token);

  const handleAccept = () => {
    accept.mutate(undefined, {
      onSuccess: (result) => {
        setLastWorkspaceId(result.workspaceId);
        toast.success("You've joined the workspace");
        navigate(paths.workspace(result.workspaceId));
      },
      onError: (err) => toast.error(err.message),
    });
  };

  if (isPending) {
    return (
      <AuthLayout title="Invitation" description="Checking your invitation…">
        <p className="text-center text-sm text-muted-foreground">Loading…</p>
      </AuthLayout>
    );
  }

  if (error || !invite) {
    const message =
      error instanceof ApiError ? error.message : "This invitation could not be found.";
    return (
      <AuthLayout title="Invitation not found" description={message}>
        <Button asChild variant="outline" className="w-full">
          <Link to={paths.home}>Go to your workspaces</Link>
        </Button>
      </AuthLayout>
    );
  }

  if (invite.status !== "pending") {
    const copy =
      invite.status === "accepted"
        ? "This invitation has already been used."
        : "This invitation has expired. Ask an admin to send a new one.";
    return (
      <AuthLayout title="Invitation unavailable" description={copy}>
        <Button asChild variant="outline" className="w-full">
          <Link to={paths.home}>Go to your workspaces</Link>
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={`Join ${invite.workspaceSlug}`}
      description={
        invite.invitedByName
          ? `${invite.invitedByName} invited you to join as ${invite.role}.`
          : `You've been invited to join as ${invite.role}.`
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          This invitation was sent to <span className="font-medium text-foreground">{invite.email}</span>.
          Make sure you're signed in with that address.
        </p>
        <Button className="w-full" disabled={accept.isPending} onClick={handleAccept}>
          {accept.isPending ? "Joining…" : "Accept invitation"}
        </Button>
      </div>
    </AuthLayout>
  );
}
