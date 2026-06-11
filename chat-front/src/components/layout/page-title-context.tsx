import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Lets the active page advertise its title to the shell's mobile top bar.
 *
 * On desktop the page's own `PageContainer` header shows the title; on mobile
 * that header scrolls with the content, so the persistent top bar needs to know
 * the current title. `PageContainer` publishes via `useSetPageTitle`, and
 * `AppShell`'s mobile bar reads it via `usePageTitle` (falling back to the
 * workspace name on pages without a `PageContainer`, e.g. the home hero).
 */
interface PageTitleContextValue {
  title: string | null;
  setTitle: (title: string | null) => void;
}

const PageTitleContext = createContext<PageTitleContextValue | null>(null);

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  // `setTitle` (the useState setter) is stable; memoize so the value identity
  // only changes when `title` does.
  const value = useMemo(() => ({ title, setTitle }), [title]);
  return <PageTitleContext.Provider value={value}>{children}</PageTitleContext.Provider>;
}

/** Current page title, or null if no page has set one. */
export function usePageTitle(): string | null {
  return useContext(PageTitleContext)?.title ?? null;
}

/** Publishes `title` to the shell while the calling component is mounted. */
export function useSetPageTitle(title: string) {
  // Grab the stable setter so the effect doesn't re-run on unrelated renders.
  const setTitle = useContext(PageTitleContext)?.setTitle;
  useEffect(() => {
    setTitle?.(title);
    return () => setTitle?.(null);
  }, [setTitle, title]);
}
