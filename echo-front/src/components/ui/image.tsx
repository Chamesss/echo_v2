import { useState, type ImgHTMLAttributes, type ReactNode } from "react";

interface ImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  /** A missing/empty src renders `fallback`, so callers don't guard first. */
  src: string | null | undefined;
  /** Empty string for decorative images (an avatar next to a visible name). */
  alt: string;
  /** Rendered in place of the image when `src` is missing or fails to load. */
  fallback?: ReactNode;
  /** Above-the-fold images that shouldn't wait to be scrolled near. */
  priority?: boolean;
}

/**
 * The single `<img>` used across the app.
 *
 * Three things it gets right that a bare tag doesn't:
 *
 *  - **Lazy by default.** A channel with hundreds of image attachments only
 *    fetches what's near the viewport. `priority` opts out for the few images
 *    that are visible immediately.
 *  - **A real fallback.** A dead URL renders `fallback` (usually initials)
 *    instead of the browser's broken-image glyph sitting inside a round avatar.
 *  - **No flash on re-render.** It renders the `<img>` directly and lets the
 *    browser serve from cache. Component libraries that gate rendering behind a
 *    JS preload (`new Image()`) must show their fallback for at least one paint
 *    every time they mount or `src` changes — the flicker this replaces.
 *
 * The corollary: `src` must be stable across renders. Appending a cache-buster
 * computed at render time (`?t=${Date.now()}`) makes every render a new URL, so
 * the browser can never reuse the decoded image and it visibly reloads.
 */
export function Image({
  src,
  alt,
  fallback = null,
  priority = false,
  onError,
  ...rest
}: ImageProps) {
  // Which src failed, not a bare "failed" flag: a new src deserves a fresh
  // attempt, and deriving that during render (rather than resetting in an
  // effect) means no extra frame showing the fallback after a working image
  // replaces a broken one.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || src === failedSrc) return <>{fallback}</>;

  return (
    <img
      {...rest}
      src={src}
      alt={alt}
      loading={rest.loading ?? (priority ? "eager" : "lazy")}
      // Decode off the main thread so a large image can't jank scrolling.
      decoding={rest.decoding ?? "async"}
      onError={(e) => {
        setFailedSrc(src);
        onError?.(e);
      }}
    />
  );
}
