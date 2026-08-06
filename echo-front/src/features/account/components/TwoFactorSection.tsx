import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { ShieldCheck, ShieldOff } from "lucide-react";
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
import {
  useDisableTwoFactor,
  useEnableTwoFactor,
  useVerifyTotp,
} from "../api/use-two-factor";
import {
  disableTwoFactorSchema,
  enableTwoFactorSchema,
  verifyTotpSchema,
  type DisableTwoFactorInput,
  type EnableTwoFactorInput,
  type VerifyTotpInput,
} from "../schemas";

/**
 * Two-factor authentication management section in /account.
 *
 * State machine:
 *   idle (off)        → "Enable" button
 *   setup             → password prompt, then QR code + verification code input
 *   idle (on)         → status + "Disable" button (password-gated)
 *
 * Backup codes appear once after a successful enable and never again. We
 * keep them inside the component state intentionally — they shouldn't be
 * persisted anywhere; if the user loses them they can regenerate via the
 * server method.
 */
export function TwoFactorSection() {
  const { data: session, refetch } = useSession();
  const isEnabled = Boolean(session?.user.twoFactorEnabled);

  const [step, setStep] = useState<"idle" | "setup" | "disable">("idle");
  const [setupData, setSetupData] = useState<{
    totpURI: string;
    backupCodes: string[];
  } | null>(null);

  const enable = useEnableTwoFactor();
  const verify = useVerifyTotp();
  const disable = useDisableTwoFactor();

  const enableForm = useForm<EnableTwoFactorInput>({
    resolver: zodResolver(enableTwoFactorSchema),
    defaultValues: { password: "" },
  });
  const verifyForm = useForm<VerifyTotpInput>({
    resolver: zodResolver(verifyTotpSchema),
    defaultValues: { code: "" },
  });
  const disableForm = useForm<DisableTwoFactorInput>({
    resolver: zodResolver(disableTwoFactorSchema),
    defaultValues: { password: "" },
  });

  const handleEnable = (values: EnableTwoFactorInput) => {
    enable.mutate(values, {
      onSuccess: (data) => {
        setSetupData({
          totpURI: data.totpURI,
          backupCodes: data.backupCodes ?? [],
        });
        enableForm.reset();
      },
      onError: toastError,
    });
  };

  const handleVerify = (values: VerifyTotpInput) => {
    verify.mutate(values, {
      onSuccess: async () => {
        toast.success("Two-factor authentication enabled");
        setSetupData(null);
        setStep("idle");
        verifyForm.reset();
        await refetch();
      },
      onError: toastError,
    });
  };

  const handleDisable = (values: DisableTwoFactorInput) => {
    disable.mutate(values, {
      onSuccess: async () => {
        toast.success("Two-factor authentication disabled");
        setStep("idle");
        disableForm.reset();
        await refetch();
      },
      onError: toastError,
    });
  };

  // ─── ENABLED ───
  if (isEnabled && step === "idle") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <ShieldCheck className="size-4 text-foreground" />
          <span className="font-medium">Two-factor authentication is on</span>
        </div>
        <p className="text-sm text-muted-foreground">
          You'll be asked for a code from your authenticator app on every sign-in.
        </p>
        <Button variant="outline" onClick={() => setStep("disable")}>
          <ShieldOff /> Disable two-factor
        </Button>
      </div>
    );
  }

  if (isEnabled && step === "disable") {
    return (
      <Form {...disableForm}>
        <form onSubmit={disableForm.handleSubmit(handleDisable)} className="space-y-4">
          <Alert variant="destructive">
            <AlertTitle>Disable two-factor authentication</AlertTitle>
            <AlertDescription>
              You'll only need your password to sign in after this. Enter your
              password to confirm.
            </AlertDescription>
          </Alert>
          <FormField
            control={disableForm.control}
            name="password"
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
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" disabled={disable.isPending}>
              {disable.isPending ? "Disabling…" : "Disable"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setStep("idle")}>
              Cancel
            </Button>
          </div>
        </form>
      </Form>
    );
  }

  // ─── DISABLED ───
  if (setupData) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertTitle>Scan the QR code</AlertTitle>
          <AlertDescription>
            Open your authenticator app (1Password, Google Authenticator, Authy)
            and scan this code. Then enter the 6-digit code below to confirm.
          </AlertDescription>
        </Alert>
        {/* `bg-white` is deliberate and must NOT become a token: QR scanners
            need a light quiet zone around the code, so this stays white even in
            dark mode. */}
        <div className="flex justify-center rounded-md border border-border bg-white p-4">
          <QRCodeSVG value={setupData.totpURI} size={180} />
        </div>
        {setupData.backupCodes.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>Save your backup codes</AlertTitle>
            <AlertDescription>
              <p className="mb-2">
                Use these one-time codes if you lose access to your authenticator.
                They won't be shown again.
              </p>
              <pre className="rounded border border-border bg-muted/40 p-3 font-mono text-xs">
                {setupData.backupCodes.join("\n")}
              </pre>
            </AlertDescription>
          </Alert>
        )}
        <Form {...verifyForm}>
          <form onSubmit={verifyForm.handleSubmit(handleVerify)} className="space-y-3">
            <FormField
              control={verifyForm.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>6-digit code</FormLabel>
                  <FormControl>
                    <Input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      maxLength={6}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={verify.isPending}>
              {verify.isPending ? "Verifying…" : "Verify and enable"}
            </Button>
          </form>
        </Form>
      </div>
    );
  }

  return (
    <Form {...enableForm}>
      <form onSubmit={enableForm.handleSubmit(handleEnable)} className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Add a second layer of security. After enabling, every sign-in requires
          a code from your authenticator app.
        </p>
        <FormField
          control={enableForm.control}
          name="password"
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
        <Button type="submit" disabled={enable.isPending}>
          <ShieldCheck /> {enable.isPending ? "Setting up…" : "Enable two-factor"}
        </Button>
      </form>
    </Form>
  );
}
