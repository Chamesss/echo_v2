import { AppProviders } from '@/providers/app-providers';
import { Router } from '@/router';

/**
 * Root component composed by `main.tsx`.
 *
 * Provider chain (outside-in): TanStack Query + Toaster + Devtools → Router.
 * Anything that needs to be available to every route lives in AppProviders,
 * not here.
 */
export default function App() {
  return (
    <AppProviders>
      <Router />
    </AppProviders>
  );
}
