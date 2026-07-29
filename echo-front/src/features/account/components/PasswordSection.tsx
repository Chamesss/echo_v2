import { useLinkedAccounts } from "../api/use-linked-accounts";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { SetPasswordForm } from "./SetPasswordForm";

/**
 * Picks the right password form for the account.
 *
 * A user who signed up through a social provider has no `credential` account,
 * so `changePassword` — which verifies a current password — can never succeed
 * for them. Same signal `ConnectedAccounts` uses to label "Email & password".
 */
export function PasswordSection() {
  const { data: accounts, isPending, error } = useLinkedAccounts();

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  // Guessing wrong here strands the user on a form they can't submit, so on a
  // failed lookup say so rather than defaulting to one of the two.
  if (error || !accounts) {
    return (
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t load your sign-in methods. Reload the page to try again.
      </p>
    );
  }

  return accounts.some((a) => a.providerId === "credential") ? (
    <ChangePasswordForm />
  ) : (
    <SetPasswordForm />
  );
}
