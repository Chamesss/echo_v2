import { Image } from "@/components/ui/image";
import { cn } from "@/lib/utils";

/**
 * Up to `max` leading letters of a name, e.g. "Ada Lovelace" → "AL". Falls back
 * to "?" so an empty or whitespace-only name still renders something.
 */
export function initials(label: string, max = 2): string {
  const parts = label.trim().split(/\s+/).slice(0, max);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

interface UserAvatarProps {
  name: string;
  image?: string | null;
  /** Sizing/spacing. Pass `h-* w-*` or `size-*`; both override the default. */
  className?: string;
  /** The 16px and 28px avatars only have room for one letter. */
  maxInitials?: number;
  /** For avatars visible on first paint (the account button in the rail). */
  priority?: boolean;
  /**
   * Presence dot. Tri-state on purpose:
   *   `undefined` → no dot. Every call site that doesn't care, and any avatar
   *                 whose presence snapshot hasn't loaded yet — nothing beats a
   *                 grey "offline" dot that flips green a moment later.
   *   `false`     → offline (muted)
   *   `true`      → online (green)
   */
  online?: boolean;
}

/**
 * A person's picture, or their initials when there's no image or it fails, with
 * an optional presence dot.
 *
 * Built on `Image`, so avatars in long lists (message rows, member tables) load
 * lazily and don't flash their initials on every re-render.
 *
 * `alt` is empty on purpose: every avatar in the app sits next to the person's
 * visible name, so naming the image again just makes screen readers say it
 * twice.
 */
export function UserAvatar({
  name,
  image,
  className,
  maxInitials = 2,
  priority,
  online,
}: UserAvatarProps) {
  return (
    // Two spans, not one. The inner span owns `overflow-hidden` — that's what
    // crops a rectangular photo into a circle — so a dot positioned there would
    // be clipped away. The outer owns position and layout, which is also why
    // `className` still lands on it: every caller's `h-8 w-8` / `size-10` /
    // `mt-0.5` / `ring-2` keeps working untouched.
    <span
      className={cn(
        "relative inline-flex h-10 w-10 shrink-0 rounded-full",
        className,
      )}
    >
      <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-medium text-muted-foreground">
        <Image
          src={image}
          alt=""
          priority={priority}
          className="h-full w-full object-cover"
          fallback={initials(name, maxInitials)}
        />
      </span>
      {online !== undefined && (
        <span
          data-testid="presence-dot"
          data-online={online}
          title={online ? "Online" : "Offline"}
          className={cn(
            "absolute -bottom-px -right-px block size-2 rounded-full ring-2 ring-background",
            online ? "bg-emerald-500" : "bg-muted-foreground",
          )}
        />
      )}
    </span>
  );
}
