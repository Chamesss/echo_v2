import { Users } from "lucide-react";
import { PageContainer, PageSection } from "@/components/layout/page-container";
import { useSession } from "@/lib/auth-client";
import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";
import { useMembers } from "@/features/members/api/use-members";
import { MembersTable } from "@/features/members/components/MembersTable";
import { InvitePanel } from "@/features/members/components/InvitePanel";
import { LeaveWorkspaceSection } from "@/features/members/components/LeaveWorkspaceSection";

/**
 * Members page — rendered inside the workspace shell at
 * `/dashboard/:workspaceId/members`. Auth + the shell come from the layout
 * chain. The roster is visible to all members; the invite panel and role/remove
 * controls are admin-only. Non-owner members get a "Leave workspace" section.
 */
export default function MembersPage() {
  const workspace = useCurrentWorkspace();
  const { data: session } = useSession();
  const canManage = workspace.role === "admin";

  const { data: members } = useMembers(workspace.id);
  const me = members?.find((m) => m.userId === session?.user.id);
  const canLeave = Boolean(me && !me.isOwner);

  return (
    <PageContainer title="Members" icon={<Users />} showBack={false}>
      <PageSection title="Members" description="Everyone in this workspace.">
        <MembersTable workspaceId={workspace.id} canManage={canManage} />
      </PageSection>

      {canManage && (
        <PageSection
          title="Invite people"
          description="Send an email invitation, or manage pending invites."
        >
          <InvitePanel workspaceId={workspace.id} />
        </PageSection>
      )}

      {canLeave && (
        <PageSection
          title="Leave workspace"
          description="Stop being a member of this workspace."
          tone="danger"
        >
          <LeaveWorkspaceSection workspaceId={workspace.id} />
        </PageSection>
      )}
    </PageContainer>
  );
}
