import { useState } from 'react';
import { toast } from 'sonner';
import { authClient, useSession } from '@/lib/auth-client';

/**
 * Global banner shown while an admin is impersonating another user.
 *
 * Impersonation swaps the cookie for a session scoped to the target (with the
 * admin's id stored in `sessions.impersonatedBy`), so the whole app renders as
 * that user — including losing the admin UI. Without an explicit exit the admin
 * would be stuck until the impersonation session expires, so this is the way
 * back: `stopImpersonating` restores the admin's original session, then we
 * reload into /admin.
 *
 * Mounted once in `RootLayout`, so it's visible on every page during an
 * impersonation. Renders nothing in the normal (non-impersonating) case.
 */
export function ImpersonationBanner() {
  const { data: session } = useSession();
  const [stopping, setStopping] = useState(false);

  if (!session?.session.impersonatedBy) return null;

  const handleStop = async () => {
    setStopping(true);
    const result = await authClient.admin.stopImpersonating();
    if (result.error) {
      setStopping(false);
      toast.error(result.error.message ?? 'Could not stop impersonating');
      return;
    }
    window.location.assign('/admin');
  };

  return (
    <div className="flex shrink-0 items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950">
      <span>
        Impersonating <strong>{session.user.email}</strong>
      </span>
      <button
        type="button"
        onClick={handleStop}
        disabled={stopping}
        className="rounded bg-amber-950/10 px-2 py-0.5 font-semibold underline-offset-2 hover:underline disabled:opacity-60"
      >
        {stopping ? 'Stopping…' : 'Stop impersonating'}
      </button>
    </div>
  );
}
