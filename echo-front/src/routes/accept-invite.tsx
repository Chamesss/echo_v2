import { useEffect, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { AuthLayout } from "@/components/layout/auth-layout";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { paths } from "@/lib/paths";
import { setLastWorkspaceId } from "@/lib/local-storage";
import { useSession, signOut } from "@/lib/auth-client";
import { useAcceptInvite, useInvite } from "@/features/members/api/use-invite";

/**
 * Invite acceptance landing page at `/accept-invite/:token` — PUBLIC (not behind
 * RequireAuth), so an unregistered invitee can view it and be routed into
 * sign-up. It's the single choke point every path converges on:
 *
 *   - logged out            → "Create account & join" / "Log in & join", both
 *                             carrying `?invite=<token>` so the auth forms come
 *                             back here.
 *   - logged in + email OK  → auto-accept + drop into the workspace.
 *   - logged in + wrong email → mismatch screen with a sign-out escape hatch.
 *   - expired / used / unknown → clear dead-ends.
 */
export default function AcceptInvitePage() {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { data: session, isPending: sessionPending } = useSession();
  const { data: invite, isPending, error } = useInvite(token);
  const accept = useAcceptInvite(token);

  const user = session?.user;
  // A public (showcase) link is addressed to nobody, so there's nothing to match
  // against and any signed-in account may accept it.
  const emailMatches =
    !!user &&
    !!invite &&
    (invite.isPublic || user.email.toLowerCase() === invite.email?.toLowerCase());

  // Auto-accept once the invite is pending AND we're signed in with the matching
  // email. Fires exactly once (guarded ref survives StrictMode's double-effect).
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    if (invite?.status !== "pending" || !emailMatches || accept.isPending) return;
    firedRef.current = true;
    accept.mutate(undefined, {
      onSuccess: (result) => {
        setLastWorkspaceId(result.workspaceId);
        toast.success("You've joined the workspace");
        void navigate(paths.workspace(result.workspaceId));
      },
      onError: (err) => {
        firedRef.current = false; // let the manual button retry
        toastError(err);
      },
    });
  }, [invite?.status, emailMatches, accept, navigate]);

  if (isPending || sessionPending) {
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

  const description = invite.invitedByName
    ? `${invite.invitedByName} invited you to join as ${invite.role}.`
    : `You've been invited to join as ${invite.role}.`;
  const withInvite = (path: string) => `${path}?invite=${encodeURIComponent(token)}`;

  // ── Logged out → route into sign-up / sign-in, carrying the token ───────────
  if (!user) {
    return (
      <AuthLayout title={`Join ${invite.workspaceSlug}`} description={description}>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {invite.isPublic ? (
              "Anyone with this link can join — create an account to have a look around."
            ) : (
              <>
                This invitation was sent to{" "}
                <span className="font-medium text-foreground">{invite.email}</span>.
              </>
            )}
          </p>
          <Button asChild className="w-full">
            <Link to={withInvite(paths.register)}>Create account &amp; join</Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link to={withInvite(paths.login)}>I already have an account</Link>
          </Button>
        </div>
      </AuthLayout>
    );
  }

  // ── Logged in but as the wrong account ──────────────────────────────────────
  if (!emailMatches) {
    return (
      <AuthLayout
        title={`Join ${invite.workspaceSlug}`}
        description="You're signed in with a different email."
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This invitation is for{" "}
            <span className="font-medium text-foreground">{invite.email}</span>, but you're signed
            in as <span className="font-medium text-foreground">{user.email}</span>.
          </p>
          <Button
            className="w-full"
            onClick={async () => {
              await signOut();
              void navigate(withInvite(paths.login));
            }}
          >
            Sign out &amp; use {invite.email}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  // ── Logged in + matching email → auto-accepting (effect above) ──────────────
  return (
    <AuthLayout title={`Join ${invite.workspaceSlug}`} description={description}>
      <p className="text-center text-sm text-muted-foreground">Joining the workspace…</p>
    </AuthLayout>
  );
}
