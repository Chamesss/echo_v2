import { useMutation } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import type { UpdateProfileInput } from "../schemas";

/**
 * Mutation wrapper around Better Auth's `updateUser`.
 *
 * Called by `ProfileForm`. Better Auth's session is refetched automatically
 * after the update so `useSession()` consumers see the new name immediately
 * — no need for an explicit cache invalidation.
 */
export function useUpdateProfile() {
  return useMutation({
    mutationFn: async (input: UpdateProfileInput) => {
      const result = await authClient.updateUser({ name: input.name });
      if (result.error) {
        throw new Error(result.error.message ?? "Could not update profile");
      }
      return result.data;
    },
  });
}
