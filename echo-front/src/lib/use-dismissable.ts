import { useEffect, useRef, useState, type RefObject } from "react";
import { useLocation } from "react-router";

/**
 * Popover open state plus the two ways it closes itself: an outside press, and a
 * route change (or a link inside the menu leaves it hanging over the new page).
 *
 * `mousedown`, not `click` — a click listener fires after the press, so dragging
 * a selection out of the panel would dismiss it.
 *
 * Attach `ref` to the wrapper holding both trigger and panel, so pressing the
 * trigger toggles instead of reading as an outside press.
 */
export function useDismissable<T extends HTMLElement = HTMLDivElement>(): {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Flip it — returns the new state so callers can act on opening. */
  toggle: () => boolean;
  // `RefObject<T>` (not `T | null`) to match what React 18's `ref` prop accepts —
  // `.current` is still nullable at runtime, which the guard below relies on.
  ref: RefObject<T>;
} {
  const [open, setOpen] = useState(false);
  const ref = useRef<T>(null);
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return {
    open,
    setOpen,
    // Computed rather than read from `open`, so a caller that toggles twice in
    // one tick still sees the right value both times.
    toggle: () => {
      const next = !open;
      setOpen(next);
      return next;
    },
    ref,
  };
}
