import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
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
import { useSetPassword } from "../api/use-set-password";
import { setPasswordSchema, type SetPasswordInput } from "../schemas";

/**
 * Set-a-first-password form, shown by `PasswordSection` when the account has no
 * `credential` provider (signed up with Google/GitHub).
 *
 * No "current password" field, because there is no current password — asking
 * for one is the dead end this form exists to fix. Nothing is signed out on
 * success either: adding a sign-in method isn't a credential rotation, so the
 * revoke-other-sessions behaviour of `ChangePasswordForm` would be wrong here.
 */
export function SetPasswordForm() {
  const { mutate, isPending } = useSetPassword();

  const form = useForm<SetPasswordInput>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  const onSubmit = (values: SetPasswordInput) => {
    mutate(values, {
      onSuccess: () => {
        toast.success("Password set. You can now sign in with your email and password.");
        form.reset();
      },
      onError: toastError,
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-md space-y-4">
        <p className="text-sm text-muted-foreground">
          You signed up with a connected account, so you don&apos;t have a password yet. Set
          one to also be able to sign in with your email address.
        </p>
        <FormField
          control={form.control}
          name="newPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm new password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={isPending}>
          {isPending ? "Setting…" : "Set password"}
        </Button>
      </form>
    </Form>
  );
}
