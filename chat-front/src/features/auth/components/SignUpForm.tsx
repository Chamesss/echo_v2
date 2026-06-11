import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router";
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
import { useSignUp } from "../api/use-sign-up";
import { Captcha, useCaptcha } from "./Captcha";
import { signUpSchema, type SignUpInput } from "../schemas";
import { SocialSignInButtons } from "./SocialSignInButtons";

/**
 * Email + password registration form, plus the Google fallback.
 *
 * Rendered by `routes/auth/register.tsx`. Better Auth's `signUp.email` also
 * creates the session, so a successful submit lands the user on `/` already
 * signed in — no separate "now sign in" step.
 */
export function SignUpForm() {
  const navigate = useNavigate();
  const { mutate, isPending } = useSignUp();
  const captcha = useCaptcha();

  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  const onSubmit = (values: SignUpInput) => {
    if (captcha.enabled && !captcha.token) {
      toast.error("Please complete the CAPTCHA");
      return;
    }
    mutate(
      { ...values, captchaToken: captcha.token },
      {
        onSuccess: () => {
          toast.success("Account created");
          navigate("/");
        },
        onError: (err) => {
          // Turnstile tokens are single-use — reset so the user can retry.
          captcha.reset();
          toast.error(err.message);
        },
      },
    );
  };

  return (
    <div className="space-y-6 max-w-xs">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Jane Doe"
                    autoComplete="name"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
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
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Captcha ref={captcha.ref} onToken={captcha.setToken} />
          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? "Creating account…" : "Create account"}
          </Button>
        </form>
      </Form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">or</span>
        </div>
      </div>

      <SocialSignInButtons />

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          to="/login"
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
