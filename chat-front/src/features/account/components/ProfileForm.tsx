import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useSession } from "@/lib/auth-client";
import { useUpdateProfile } from "../api/use-update-profile";
import { updateProfileSchema, type UpdateProfileInput } from "../schemas";
import { AvatarUploader } from "./AvatarUploader";

/**
 * Profile section in /account — avatar + display name.
 *
 * The avatar uploader is a self-contained subflow (upload happens immediately
 * on file select). The name field has its own submit button so renaming
 * doesn't accidentally fire on every keystroke. RHF's `values` prop keeps
 * the input in sync with `session.user.name` after external updates.
 */
export function ProfileForm() {
  const { data: session } = useSession();
  const { mutate, isPending } = useUpdateProfile();

  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    values: { name: session?.user.name ?? "" },
  });

  const onSubmit = (values: UpdateProfileInput) => {
    mutate(values, {
      onSuccess: () => toast.success("Profile updated"),
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <div className="max-w-md space-y-6">
      <AvatarUploader />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Display name</FormLabel>
                <FormControl>
                  <Input autoComplete="name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            disabled={isPending || !form.formState.isDirty}
          >
            {isPending ? "Saving…" : "Save"}
          </Button>
        </form>
      </Form>
    </div>
  );
}
