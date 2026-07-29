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
}

/**
 * A person's picture, or their initials when there's no image or it fails.
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
}: UserAvatarProps) {
  return (
    <span
      className={cn(
        "relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-medium text-muted-foreground",
        className,
      )}
    >
      <Image
        src={image}
        alt=""
        priority={priority}
        className="h-full w-full object-cover"
        fallback={initials(name, maxInitials)}
      />
    </span>
  );
}
