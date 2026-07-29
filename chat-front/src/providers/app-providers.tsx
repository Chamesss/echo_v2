import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
// import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "sonner";
import { queryClient } from "@/lib/query-client";
import { AppearanceProvider, useAppearance } from "@/features/appearance/appearance-provider";

/**
 * Wraps the entire app with the providers every feature can assume are
 * present: TanStack Query, appearance/theming, the Sonner toast portal, and the
 * React Query Devtools (visible in dev only — they tree-shake out in
 * production builds).
 *
 * `AppearanceProvider` sits inside `QueryClientProvider` because it fetches the
 * user's stored preferences, and outside everything else because every route —
 * including the signed-out auth pages — needs to be themed.
 *
 * New global providers go here so individual features don't have to know
 * about them. Used once by `App.tsx`.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AppearanceProvider>
        {children}
        <ThemedToaster />
      </AppearanceProvider>
      {/* <ReactQueryDevtools initialIsOpen={false} /> */}
    </QueryClientProvider>
  );
}

/**
 * Sonner renders into a portal outside the React tree's styled surfaces, so it
 * can't inherit the mode from CSS — it has to be told explicitly, or toasts
 * come out light-on-light in dark mode.
 */
function ThemedToaster() {
  const { resolvedMode } = useAppearance();
  return <Toaster richColors closeButton theme={resolvedMode} />;
}
