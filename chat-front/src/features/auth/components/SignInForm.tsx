import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { paths } from "@/lib/paths";
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
import { useSignIn } from "../api/use-sign-in";
import { Captcha, useCaptcha } from "./Captcha";
import { useVerifyTotp } from "@/features/account/api/use-two-factor";
import { signInSchema, type SignInInput } from "../schemas";
import {
  verifyTotpSchema,
  type VerifyTotpInput,
} from "@/features/account/schemas";
import { SocialSignInButtons } from "./SocialSignInButtons";

/**
 * Email + password sign-in form, with optional 2FA challenge step.
 *
 * Two phases:
 *   1. Credentials  — email + password. On success without 2FA, navigate to /
 *   2. 2FA challenge — if `signIn.email` returns `data.twoFactorRedirect`
 *     true, swap to a TOTP input. Verify, then navigate to /.
 *
 * Both phases stay on the same route so a browser back button doesn't strand
 * the user mid-flow. Google sign-in is shown only in phase 1.
 */
export function SignInForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inviteToken = params.get("invite") ?? "";
  // On an invite sign-in, return to the accept page (it auto-joins); else home.
  const successTarget = inviteToken ? paths.acceptInvite(inviteToken) : "/";
  const signInMut = useSignIn();
  const verifyMut = useVerifyTotp();
  const captcha = useCaptcha();

  const [twoFactorRequired, setTwoFactorRequired] = useState(false);

  const credentialsForm = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const totpForm = useForm<VerifyTotpInput>({
    resolver: zodResolver(verifyTotpSchema),
    defaultValues: { code: "" },
  });

  const onCredentials = (values: SignInInput) => {
    if (captcha.enabled && !captcha.token) {
      toast.error("Please complete the CAPTCHA");
      return;
    }
    signInMut.mutate(
      { ...values, captchaToken: captcha.token },
      {
        onSuccess: (data) => {
          // Better Auth's two-factor plugin returns `twoFactorRedirect: true`
          // when the account requires a second factor. Swap UI instead of
          // navigating away — the session isn't fully established yet. (The
          // TOTP verify step isn't CAPTCHA-gated, so no widget there.)
          if ((data as { twoFactorRedirect?: boolean }).twoFactorRedirect) {
            setTwoFactorRequired(true);
            return;
          }
          toast.success("Signed in");
          navigate(successTarget);
        },
        onError: (err) => {
          // Turnstile tokens are single-use — reset so the user can retry.
          captcha.reset();
          toast.error(err.message);
        },
      },
    );
  };

  const onVerifyTotp = (values: VerifyTotpInput) => {
    verifyMut.mutate(values, {
      onSuccess: () => {
        toast.success("Signed in");
        navigate(successTarget);
      },
      onError: (err) => toast.error(err.message),
    });
  };

  if (twoFactorRequired) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Open your authenticator app and enter the 6-digit code for Chat.
        </p>
        <Form {...totpForm}>
          <form
            onSubmit={totpForm.handleSubmit(onVerifyTotp)}
            className="space-y-4"
          >
            <FormField
              control={totpForm.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Authenticator code</FormLabel>
                  <FormControl>
                    <Input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      maxLength={6}
                      autoFocus
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              className="w-full"
              disabled={verifyMut.isPending}
            >
              {verifyMut.isPending ? "Verifying…" : "Verify and sign in"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setTwoFactorRequired(false);
                totpForm.reset();
              }}
            >
              Back to sign in
            </Button>
          </form>
        </Form>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-xs">
      <Form {...credentialsForm}>
        <form
          onSubmit={credentialsForm.handleSubmit(onCredentials)}
          className="space-y-4"
        >
          <FormField
            control={credentialsForm.control}
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
            control={credentialsForm.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between">
                  <FormLabel>Password</FormLabel>
                  <Link
                    to="/forgot-password"
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Forgot?
                  </Link>
                </div>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Captcha ref={captcha.ref} onToken={captcha.setToken} />
          <Button
            type="submit"
            className="w-full"
            disabled={signInMut.isPending}
          >
            {signInMut.isPending ? "Signing in…" : "Sign in"}
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
        Don't have an account?{" "}
        <Link
          to={inviteToken ? `${paths.register}?invite=${encodeURIComponent(inviteToken)}` : paths.register}
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          Sign up
        </Link>
      </p>
    </div>
  );
}
