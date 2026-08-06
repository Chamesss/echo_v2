import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { Mail } from "lucide-react";
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
import { ApiError } from "@/lib/api";
import { useCreateInvite } from "../api/use-invites";
import { inviteSchema, type InviteInput } from "../schemas";

/**
 * Admin-only invite form: invite someone by email (sends a tokenized accept
 * link). The raw token never reaches the client — delivery is by email only.
 * Still-pending invites are shown in the member roster as "Invited" rows.
 */
export function InvitePanel({ workspaceId }: { workspaceId: string }) {
  const createInvite = useCreateInvite(workspaceId);

  const form = useForm<InviteInput>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: "member" },
  });

  const onSubmit = (values: InviteInput) => {
    createInvite.mutate(values, {
      onSuccess: (invite) => {
        toast.success(`Invitation sent to ${invite.email}`);
        form.reset({ email: "", role: "member" });
      },
      onError: (err) => {
        if (err instanceof ApiError && err.code === "already_a_member") {
          form.setError("email", { message: "That person is already a member" });
          return;
        }
        toastError(err);
      },
    });
  };

  return (
    <div className="space-y-6">
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-3 sm:flex-row sm:items-start"
        >
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel className="sr-only">Email</FormLabel>
                <FormControl>
                  <Input type="email" placeholder="teammate@company.com" autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="role"
            render={({ field }) => (
              <FormItem className="sm:w-36">
                <FormLabel className="sr-only">Role</FormLabel>
                <FormControl>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    {...field}
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </FormControl>
              </FormItem>
            )}
          />
          <Button type="submit" disabled={createInvite.isPending} className="sm:mt-0">
            <Mail /> {createInvite.isPending ? "Sending…" : "Send invite"}
          </Button>
        </form>
      </Form>
    </div>
  );
}
