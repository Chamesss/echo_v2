import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tailwind class-name combiner used by every shadcn component.
 *
 * `clsx` handles conditional class lists; `twMerge` resolves Tailwind utility
 * conflicts (e.g. `px-2` and `px-4` → just `px-4`). Required by the shadcn
 * CLI when it generates components.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const bustCache = (src: string | null): string => {
  if (!src) return "";
  const cacheBustedUrl = src.includes("?")
    ? `${src}&timestamp=${Date.now()}`
    : `${src}?timestamp=${Date.now()}`;
  return cacheBustedUrl;
};
