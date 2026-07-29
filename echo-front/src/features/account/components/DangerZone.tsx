import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
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
import { clearLastWorkspaceId } from "@/lib/local-storage";
import { useDeleteAccount } from "../api/use-delete-account";
import { deleteAccountSchema, type DeleteAccountInput } from "../schemas";

/**
 * Account deletion section in /account.
 *
 * Two-stage gate:
 *   1. Click "Delete my account" to reveal the form (so the destructive
 *      action is never a single click)
 *   2. Type the literal word DELETE + enter password
 *
 * The backend additionally enforces ownership checks: if the user is the
 * sole owner of a workspace, deletion errors out with a message (the
 * workspaces.owner_id FK is `onDelete: restrict`). We surface that as a
 * toast and let the user resolve it manually — handling cross-workspace
 * ownership transfer in-flow is a Phase 6+ design problem.
 */
export function DangerZone() {
  const navigate = useNavigate();
  const [revealed, setRevealed] = useState(false);
  const { mutate, isPending } = useDeleteAccount();

  const form = useForm<DeleteAccountInput>({
    resolver: zodResolver(deleteAccountSchema),
    defaultValues: { confirmation: "DELETE", password: "" },
  });

  const onSubmit = (values: DeleteAccountInput) => {
    mutate(values, {
      onSuccess: () => {
        clearLastWorkspaceId();
        toast.success("Your account has been deleted");
        navigate("/login");
      },
      onError: (err) => toast.error(err.message),
    });
  };

  if (!revealed) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Permanently delete your account and remove access to every workspace
          you've joined. This can't be undone.
        </p>
        <Button variant="destructive" onClick={() => setRevealed(true)}>
          <Trash2 /> Delete my account
        </Button>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <Alert variant="destructive">
          <AlertTitle>This is permanent</AlertTitle>
          <AlertDescription>
            Your account, sessions, and memberships will be deleted. If you
            own any workspaces, you'll need to transfer ownership first or
            deletion will fail.
          </AlertDescription>
        </Alert>
        <FormField
          control={form.control}
          name="confirmation"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Type DELETE to confirm</FormLabel>
              <FormControl>
                <Input autoComplete="off" placeholder="DELETE" {...field} />
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
              <FormLabel>Current password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex gap-2">
          <Button type="submit" variant="destructive" disabled={isPending}>
            {isPending ? "Deleting…" : "Delete my account"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setRevealed(false);
              form.reset();
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );
}
