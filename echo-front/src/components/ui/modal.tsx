import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared modal shell: backdrop, panel, titled header, and the two dismissals
 * every dialog wants (Escape, backdrop click).
 *
 * `children` is everything below the header and deliberately unopinionated —
 * one caller wants a scrolling body, the other a body plus a sticky footer.
 *
 * `app-shell`'s overlay is a drawer, not a dialog, so it stays separate.
 */
export function Modal({
  title,
  label,
  onClose,
  size = "md",
  children,
}: {
  /** Rendered in the header. May be dynamic (it re-reads on every render). */
  title: ReactNode;
  /** Accessible name for the dialog. Needed when `title` isn't a plain string. */
  label: string;
  onClose: () => void;
  size?: "sm" | "md";
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={cn(
          "flex max-h-[85vh] w-full flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl",
          size === "sm" ? "max-w-sm" : "max-w-md",
        )}
        // Without this, any click inside the panel bubbles to the backdrop's
        // handler and closes the dialog the user is trying to use.
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <h2 className="min-w-0 truncate font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        {children}
      </div>
    </div>
  );
}
