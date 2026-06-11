import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { useSetPageTitle } from "./page-title-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Unified shell for the app's "inside" pages — account settings, admin, and
 * future areas like channels/options. Rendered inside `AppShell`'s scrollable
 * content area. Every such page gets the same chrome: a header bar (optional
 * back button + icon + title/description + right-aligned actions) and a
 * full-width content area that stacks `PageSection`s with consistent spacing.
 *
 * Content is full-width (no centered max-width column) so it uses all the space
 * the shell gives it — no dead side margins. Horizontal padding scales with the
 * viewport.
 *
 * The header renders on desktop only (`lg:`), sticky and aligned with the
 * sidebar header. On mobile it's hidden to avoid a double header — `AppShell`'s
 * own top bar already shows the page title (via `useSetPageTitle`) next to the
 * menu button. Pass `showBack={false}` when the sidebar is the nav.
 */
interface PageContainerProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  /** Right-aligned header controls (buttons, etc.). */
  actions?: ReactNode;
  /** Show the "Back" button (navigates to history -1). Default true. */
  showBack?: boolean;
  children: ReactNode;
}

export function PageContainer({
  title,
  description,
  icon,
  actions,
  showBack = true,
  children,
}: PageContainerProps) {
  const navigate = useNavigate();
  // Surface the title to the shell's mobile top bar (no-op on desktop, where
  // this header is the bar).
  useSetPageTitle(title);

  return (
    <div className="flex min-h-full flex-col bg-background">
      {/* h-16 + border-b on the SAME element so (with box-sizing:border-box)
          the border is included in the 64px — matching AppShell's sidebar
          header exactly. Putting the border on a wrapper instead would add 1px
          and make this bar 1px taller. lg:sticky keeps it as a continuous top
          bar with the sidebar on desktop while the content below scrolls. */}
      <header className="flex h-16 hidden lg:flex items-center gap-3 border-b border-border bg-card px-4 sm:px-6 lg:sticky lg:top-0 lg:z-10 lg:px-8">
        {showBack && (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 shrink-0"
            onClick={() => navigate(-1)}
            aria-label="Back"
          >
            <ArrowLeft />
            {/* Label hidden on narrow screens to keep the header compact. */}
            <span className="hidden sm:inline">Back</span>
          </Button>
        )}
        {icon && (
          <span
            className="shrink-0 text-muted-foreground [&_svg]:size-5"
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold leading-tight">
            {title}
          </h1>
          {description && (
            <p className="truncate text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {actions}
          </div>
        )}
      </header>

      <main className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}

/**
 * A titled card section inside a `PageContainer`. Standardizes the
 * title / description / content rhythm so every section across settings, admin,
 * and future pages looks identical. Use `tone="danger"` for destructive areas.
 */
interface PageSectionProps {
  title: string;
  description?: string;
  tone?: "default" | "danger";
  children: ReactNode;
}

export function PageSection({
  title,
  description,
  tone = "default",
  children,
}: PageSectionProps) {
  const danger = tone === "danger";
  return (
    <Card className={danger ? "border-destructive/40" : undefined}>
      <CardHeader>
        <CardTitle className={danger ? "text-destructive" : undefined}>
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
