import { SlidersHorizontal } from "lucide-react";
import { PageContainer, PageSection } from "@/components/layout/page-container";
import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";
import { WorkspaceRenameForm } from "@/features/workspaces/components/WorkspaceRenameForm";
import { DeleteWorkspaceSection } from "@/features/workspaces/components/DeleteWorkspaceSection";
import { NotificationSettingsSection } from "@/features/notifications/components/NotificationSettingsSection";

/**
 * Workspace settings — rendered inside the shell at
 * `/dashboard/:workspaceId/workspace-settings`. Distinct from the personal
 * account page (`/settings`). General settings (rename) are admin-only; the
 * delete danger zone is owner-only. A non-admin who lands here sees a read-only
 * summary rather than controls.
 */
export default function WorkspaceSettingsPage() {
  const workspace = useCurrentWorkspace();
  const canManage = workspace.role === "admin";

  return (
    <PageContainer title="Workspace settings" icon={<SlidersHorizontal />} showBack={false}>
      {canManage ? (
        <PageSection title="General" description="Rename your workspace.">
          <WorkspaceRenameForm />
        </PageSection>
      ) : (
        <PageSection title="General" description="Workspace details.">
          <dl className="space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Name:</dt>
              <dd className="font-medium text-foreground">{workspace.name}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">URL:</dt>
              <dd className="font-mono text-foreground">chat.app/{workspace.slug}</dd>
            </div>
          </dl>
        </PageSection>
      )}

      <PageSection
        title="Notifications"
        description="Control the notification bell + toasts for this workspace."
      >
        <NotificationSettingsSection workspaceId={workspace.id} />
      </PageSection>

      {workspace.isOwner && (
        <PageSection
          title="Danger zone"
          description="Permanent actions you can't undo."
          tone="danger"
        >
          <DeleteWorkspaceSection />
        </PageSection>
      )}
    </PageContainer>
  );
}
