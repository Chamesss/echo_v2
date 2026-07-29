import { PageContainer, PageSection } from "@/components/layout/page-container";
import { ProfileForm } from "@/features/account/components/ProfileForm";
import { AppearanceSection } from "@/features/appearance/components/AppearanceSection";
import { ChangeEmailForm } from "@/features/account/components/ChangeEmailForm";
import { PasswordSection } from "@/features/account/components/PasswordSection";
import { ConnectedAccounts } from "@/features/account/components/ConnectedAccounts";
import { TwoFactorSection } from "@/features/account/components/TwoFactorSection";
import { SessionsCard } from "@/features/account/components/SessionsCard";
import { DangerZone } from "@/features/account/components/DangerZone";

/**
 * Account settings page — profile, email, password, connected accounts, 2FA,
 * sessions, delete.
 *
 * Rendered inside the workspace shell (`AppShell`) at
 * `/dashboard/:workspaceId/settings` — auth + the shell come from the layout
 * chain, so this page is just the `PageContainer` + sections. `showBack` is off
 * because the sidebar is the navigation. Each section is a self-contained
 * feature component, so the page stays pure composition.
 */
export default function AccountPage() {
  return (
    <PageContainer title="Account settings" showBack={false}>
      <PageSection title="Profile" description="How you appear to other members.">
        <ProfileForm />
      </PageSection>

      <PageSection
        title="Appearance"
        description="Personal to you — these settings follow you into every workspace and onto every device you sign in from."
      >
        <AppearanceSection />
      </PageSection>

      <PageSection title="Email" description="Used for sign-in and account recovery.">
        <ChangeEmailForm />
      </PageSection>

      <PageSection title="Password" description="Use at least 8 characters.">
        <PasswordSection />
      </PageSection>

      <PageSection
        title="Connected accounts"
        description="Sign-in methods linked to your account. Connect a provider for one-tap sign-in, or disconnect anytime."
      >
        <ConnectedAccounts />
      </PageSection>

      <PageSection
        title="Two-factor authentication"
        description="Require an authenticator-app code on every sign-in."
      >
        <TwoFactorSection />
      </PageSection>

      <PageSection
        title="Sessions"
        description="Devices currently signed in to your account."
      >
        <SessionsCard />
      </PageSection>

      <PageSection
        title="Danger zone"
        description="Permanent actions you can't undo."
        tone="danger"
      >
        <DangerZone />
      </PageSection>
    </PageContainer>
  );
}
