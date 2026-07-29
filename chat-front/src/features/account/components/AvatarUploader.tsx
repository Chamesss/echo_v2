import { useRef } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { useUploadAvatar } from "../api/use-upload-avatar";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — keep in sync with backend AVATAR_MAX_SIZE_MB

/**
 * Avatar display + click-to-upload control.
 *
 * Rendered as part of `ProfileForm`. Validates file type and size client-side
 * (before triggering the backend round trip) so an obviously-wrong file
 * gives instant feedback. The actual upload is the three-step flow in
 * `useUploadAvatar` (presign → S3 PUT → updateUser).
 *
 * The session refetches after `updateUser`, which propagates the new
 * `user.image` everywhere `useSession()` is consumed (header avatar,
 * future workspace member lists, etc.).
 */
export function AvatarUploader() {
  const { data: session, refetch } = useSession();
  const { mutate, isPending } = useUploadAvatar();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so re-uploading the same file fires a fresh change event.
    e.target.value = "";
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Please select a JPEG, PNG, or WebP image");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Image must be under 5 MB");
      return;
    }

    mutate(file, {
      onSuccess: async () => {
        toast.success("Profile picture updated");
        await refetch();
      },
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <div className="flex items-center gap-4">
      {/* Each upload lands on a new S3 key (`avatar-<timestamp>.jpg`), so the
          URL already changes when the picture does — no cache-busting needed,
          and adding it per-render is what made this avatar reload on focus. */}
      <UserAvatar
        name={session?.user.name ?? "?"}
        image={session?.user.image}
        className="h-20 w-20 text-lg"
        priority
      />

      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => inputRef.current?.click()}
        >
          <Upload /> {isPending ? "Uploading…" : "Change picture"}
        </Button>
        <p className="text-xs text-muted-foreground">
          JPEG, PNG, or WebP. Up to 5&nbsp;MB.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_TYPES.join(",")}
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
    </div>
  );
}
