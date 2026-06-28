import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
// import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "sonner";
import { queryClient } from "@/lib/query-client";

/**
 * Wraps the entire app with the providers every feature can assume are
 * present: TanStack Query, the Sonner toast portal, and the React Query
 * Devtools (visible in dev only — they tree-shake out in production builds).
 *
 * New global providers go here so individual features don't have to know
 * about them. Used once by `App.tsx`.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster richColors closeButton />
      {/* <ReactQueryDevtools initialIsOpen={false} /> */}
    </QueryClientProvider>
  );
}
