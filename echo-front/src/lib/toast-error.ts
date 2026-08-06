import { toast } from "sonner";
import { ApiError } from "./api";

/**
 * The one place a failed mutation becomes a message — pass as `onError: toastError`.
 * Replaces ~28 copies of `toast.error(err.message)`, so error copy has one home.
 */
export function toastError(error: unknown): void {
  toast.error(messageFor(error));
}

/** `unknown`, not `Error`, so mutation `onError` and a bare `catch` both fit. */
function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return "You're going a bit fast — try again in a moment.";
    if (error.status >= 500) return "Something went wrong on our end. Please try again.";
    return error.message;
  }
  // A network failure or a non-API throw. `message` here is a fetch internal
  // ("Failed to fetch") that tells the user nothing actionable.
  return "Something went wrong. Check your connection and try again.";
}
