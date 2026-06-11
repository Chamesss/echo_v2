import { Shield } from 'lucide-react';
import { PageContainer, PageSection } from '@/components/layout/page-container';
import { AdminUsersTable } from '@/features/admin/components/AdminUsersTable';

/**
 * Admin dashboard, rendered inside the workspace shell at
 * `/dashboard/:workspaceId/admin`. Auth + the `RequireAdmin` gate + the sidebar
 * shell all come from the layout chain, so this page is just content. Uses the
 * default `PageContainer` width so it lines up identically with account
 * settings; `showBack` off (sidebar is the nav).
 *
 * v1 surface: user management — search, role promote/demote, ban/unban,
 * impersonate, and delete.
 */
export default function AdminPage() {
  return (
    <PageContainer title="Admin" icon={<Shield />} showBack={false}>
      <PageSection
        title="Users"
        description="Manage accounts across the whole application — roles, bans, impersonation, and deletion."
      >
        <AdminUsersTable />
      </PageSection>
    </PageContainer>
  );
}
