import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";
import { useUpdateWorkspace } from "../api/use-update-workspace";
import { updateWorkspaceSchema, type UpdateWorkspaceInput } from "../schemas";

/**
 * Rename the workspace display name. The slug is shown read-only — it backs the
 * tenant schema name and can't change.
 */
export function WorkspaceRenameForm() {
  const workspace = useCurrentWorkspace();
  const update = useUpdateWorkspace(workspace.id);

  const form = useForm<UpdateWorkspaceInput>({
    resolver: zodResolver(updateWorkspaceSchema),
    defaultValues: { name: workspace.name },
  });

  const onSubmit = (values: UpdateWorkspaceInput) => {
    update.mutate(values, {
      onSuccess: () => {
        toast.success("Workspace renamed");
        form.reset({ name: values.name });
      },
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Display name</FormLabel>
              <FormControl>
                <Input placeholder="Acme Inc." {...field} />
              </FormControl>
              <FormDescription>
                URL: <span className="font-mono">echo.app/{workspace.slug}</span> (can't be changed)
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={update.isPending || !form.formState.isDirty}>
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </form>
    </Form>
  );
}
