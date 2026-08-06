import { useForm } from 'react-hook-form';
import { zodResolver } from "@/lib/zod-resolver";
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { toastError } from '@/lib/toast-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useResetPassword } from '../api/use-reset-password';
import { resetPasswordSchema, type ResetPasswordInput } from '../schemas';

/**
 * Set-new-password form, reached via the link in the reset email.
 *
 * Rendered by `routes/auth/reset-password.tsx`. The token comes from the
 * `?token=...` query string Better Auth puts in the email link. Missing or
 * malformed token → show an error with a path back to /forgot-password
 * instead of letting the user type into a form that will fail on submit.
 */
export function ResetPasswordForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const { mutate, isPending } = useResetPassword();

  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  if (!token) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Missing reset token</AlertTitle>
        <AlertDescription>
          This page must be opened via the link in your password reset email.{' '}
          <Link to="/forgot-password" className="underline underline-offset-2">
            Request a new one
          </Link>
          .
        </AlertDescription>
      </Alert>
    );
  }

  const onSubmit = (values: ResetPasswordInput) => {
    mutate(
      { newPassword: values.newPassword, token },
      {
        onSuccess: () => {
          toast.success('Password updated');
          void navigate('/login');
        },
        onError: toastError,
      },
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? 'Updating…' : 'Update password'}
        </Button>
      </form>
    </Form>
  );
}
