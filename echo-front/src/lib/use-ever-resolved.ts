import { useEffect, useState } from "react";

/**
 * Latches true once `isPending` first goes false, and stays true.
 *
 * The three route guards use this to show the full-screen spinner only on the
 * INITIAL session load. better-auth sets `isPending` true again on every
 * background refetch (focus, post-mutation), which would otherwise flash the
 * spinner and unmount the page each time.
 *
 * A ref written during render would be simpler but is unsafe under concurrent
 * rendering; the latch is only read when `isPending` is true, so the one-tick
 * delay before the effect commits is unobservable.
 */
export function useEverResolved(isPending: boolean): boolean {
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    if (!isPending) setResolved(true);
  }, [isPending]);

  return resolved;
}
