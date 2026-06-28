/**
 * Whether this tab is the foreground (visible) tab.
 *
 * Use this — not `document.hasFocus()` — as the "the user is looking at this tab"
 * signal for read receipts / mark-as-seen. `hasFocus()` returns false whenever
 * DevTools or another OS window holds focus, which would wrongly freeze the read
 * cursor; `visibilityState` stays "visible" as long as the tab is in the
 * foreground of its window. Guards `document` for non-browser (test/SSR) calls.
 */
export function isTabVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}
