import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useSession } from "@/lib/auth-client";
import { useChangeEmail } from "../api/use-change-email";
import { changeEmailSchema, type ChangeEmailInput } from "../schemas";

/**
 * Email-change request form.
 *
 * The backend sends a confirmation email to the CURRENT address — the swap
 * doesn't happen until that email is clicked. We surface this in copy so
 * the user knows nothing changes yet on submit.
 */
export function ChangeEmailForm() {
  const { data: session } = useSession();
  const { mutate, isPending } = useChangeEmail();

  const form = useForm<ChangeEmailInput>({
    resolver: zodResolver(changeEmailSchema),
    defaultValues: { newEmail: "" },
  });

  const onSubmit = (values: ChangeEmailInput) => {
    mutate(values, {
      onSuccess: () => {
        toast.success(
          "Check your current inbox for a confirmation link to complete the change.",
        );
        form.reset();
      },
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <div className="max-w-md space-y-4">
      <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
        <div className="text-muted-foreground">Current email</div>
        <div className="font-medium text-foreground">{session?.user.email}</div>
      </div>
      <Alert>
        <AlertTitle>Confirmation required</AlertTitle>
        <AlertDescription>
          We'll send a link to your current email address. Your email only
          changes after you click that link.
        </AlertDescription>
      </Alert>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="newEmail"
            render={({ field }) => (
              <FormItem>
                <FormLabel>New email</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder="you@new-domain.com"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" disabled={isPending}>
            {isPending ? "Sending…" : "Send confirmation"}
          </Button>
        </form>
      </Form>
    </div>
  );
}
