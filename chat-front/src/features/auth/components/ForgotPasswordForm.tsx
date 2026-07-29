import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { Link } from "react-router";
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
import { useForgotPassword } from "../api/use-forgot-password";
import { Captcha, useCaptcha } from "./Captcha";
import { forgotPasswordSchema, type ForgotPasswordInput } from "../schemas";

/**
 * Password-reset request form.
 *
 * Rendered by `routes/auth/forgot-password.tsx`. After a successful submit we
 * swap the form for a "check your email" confirmation. We don't reveal
 * whether the address was registered — that's a privacy/enumeration defense
 * and matches Better Auth's default behavior on the backend.
 */
export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const { mutate, isPending } = useForgotPassword();
  const captcha = useCaptcha();

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = (values: ForgotPasswordInput) => {
    if (captcha.enabled && !captcha.token) {
      toast.error("Please complete the CAPTCHA");
      return;
    }
    mutate(
      { ...values, captchaToken: captcha.token },
      {
        onSuccess: () => setSent(true),
        onError: (err) => {
          // Turnstile tokens are single-use — reset so the user can retry.
          captcha.reset();
          toast.error(err.message);
        },
      },
    );
  };

  if (sent) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertTitle>Check your email</AlertTitle>
          <AlertDescription>
            If an account exists for that address, we've sent a password reset
            link. It expires in 1 hour.
          </AlertDescription>
        </Alert>
        <p className="text-center text-sm text-muted-foreground">
          <Link
            to="/login"
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4 max-w-xs"
      >
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Captcha ref={captcha.ref} onToken={captcha.setToken} />
        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? "Sending…" : "Send reset link"}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          <Link
            to="/login"
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </form>
    </Form>
  );
}
