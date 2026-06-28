import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
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
import { useCreateInvite, useInvites } from "../api/use-invites";
import { inviteSchema, type InviteInput } from "../schemas";

/**
 * Admin-only invitations panel: invite someone by email (sends a tokenized
 * accept link), plus the list of still-pending invites. The raw token never
 * reaches the client — delivery is by email only.
 */
export function InvitePanel({ workspaceId }: { workspaceId: string }) {
  const createInvite = useCreateInvite(workspaceId);
  const { data: invites } = useInvites(workspaceId);

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
        toast.error(err.message);
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

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Pending invitations
        </h3>
        {!invites || invites.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending invitations.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 truncate text-foreground">{inv.email}</span>
                <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                  <span className="capitalize">{inv.role}</span>
                  <span>expires {new Date(inv.expiresAt).toLocaleDateString()}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
