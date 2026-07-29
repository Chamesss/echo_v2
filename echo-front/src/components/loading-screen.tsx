/**
 * Full-screen loading indicator used by the auth guards while the session
 * status is resolving. Kept intentionally simple — a real app might swap in
 * a branded splash, but the spinner is enough to mask the FOUC between
 * "no idea if user is logged in" and the first real render.
 */
export function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
    </div>
  );
}
