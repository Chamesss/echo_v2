import { useMutation } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { ApiError, apiFetch } from "@/lib/api";
import { API_URL } from "@/config/env";

/**
 * Stable URL for an owned, private-bucket object via the server's signed-redirect
 * endpoint. The bucket is private, so we never persist the raw S3 public URL
 * (it 403s); we persist this pointer instead and the server 302s each load to a
 * freshly-signed GET. Mirrors how message attachments are served.
 */
function fileProxyUrl(key: string): string {
  return `${API_URL}/api/files?key=${encodeURIComponent(key)}`;
}

interface PresignResponse {
  uploadUrl: string;
  publicUrl: string;
  key: string;
}

/**
 * Three-step avatar upload, wrapped in a single React Query mutation.
 *
 * Called by `AvatarUploader`. Steps:
 *   1. POST /api/users/me/avatar    → presigned S3 PUT URL + final public URL
 *   2. PUT  <uploadUrl> (the file)  → S3 stores the object (bytes never
 *                                     traverse our server)
 *   3. authClient.updateUser({...}) → persist publicUrl on user.image so
 *                                     `useSession()` consumers re-render
 *
 * Caller passes the raw `File` object. We surface clear errors for the two
 * places this can fail differently: presign rejection (validation / S3 not
 * configured) vs. the actual S3 upload failing (network / size mismatch).
 *
 * Returns the new public URL on success so the caller can optimistically
 * render it without waiting for the session refetch.
 */
export function useUploadAvatar() {
  return useMutation({
    mutationFn: async (file: File): Promise<{ publicUrl: string }> => {
      // 1. Ask the backend for a presigned URL bound to this exact file.
      let presign: PresignResponse;
      try {
        presign = await apiFetch<PresignResponse>("/api/users/me/avatar", {
          method: "POST",
          body: { contentType: file.type, contentLength: file.size },
        });
      } catch (err) {
        if (err instanceof ApiError && err.code === "uploads_not_configured") {
          throw new Error(
            "Avatar uploads aren't enabled on this server. Configure S3_BUCKET in the backend env.",
            // Keep the original reachable: this replaces a server error code with
            // operator-facing advice, and losing the response behind it would make
            // the real cause unrecoverable from a log.
            { cause: err },
          );
        }
        throw err;
      }

      // 2. Upload the file bytes directly to S3.
      const uploadResponse = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error(`Upload to storage failed (HTTP ${uploadResponse.status})`);
      }

      // 3. Persist the URL on the user row via Better Auth. The bucket is
      // private, so we store the signed-redirect pointer (not presign.publicUrl,
      // which 403s) — the server re-signs each load.
      const imageUrl = fileProxyUrl(presign.key);
      const updated = await authClient.updateUser({ image: imageUrl });
      if (updated.error) {
        throw new Error(updated.error.message ?? "Could not save avatar URL");
      }

      return { publicUrl: imageUrl };
    },
  });
}
