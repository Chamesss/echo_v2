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
import { useChangePassword } from "../api/use-change-password";
import { changePasswordSchema, type ChangePasswordInput } from "../schemas";

/**
 * Change-password form.
 *
 * Rendered as one section of `routes/account.tsx`. Defaults
 * `revokeOtherSessions: true` so a password change signs the user out
 * everywhere else — the standard "compromised credentials" response.
 *
 * On success the form resets to empty (no point keeping the old values
 * around) and a confirmation toast fires.
 */
export function ChangePasswordForm() {
  const { mutate, isPending } = useChangePassword();

  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
      revokeOtherSessions: true,
    },
  });

  const onSubmit = (values: ChangePasswordInput) => {
    mutate(values, {
      onSuccess: () => {
        toast.success("Password updated. Other sessions have been signed out.");
        form.reset();
      },
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-md space-y-4">
        <FormField
          control={form.control}
          name="currentPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Current password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
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
          {isPending ? "Updating…" : "Change password"}
        </Button>
      </form>
    </Form>
  );
}
