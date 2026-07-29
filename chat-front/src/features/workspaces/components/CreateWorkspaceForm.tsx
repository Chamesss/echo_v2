import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { useNavigate } from "react-router";
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
import { ApiError } from "@/lib/api";
import { setLastWorkspaceId } from "@/lib/local-storage";
import { useCreateWorkspace } from "../api/use-create-workspace";
import { finalizeSlugInput, normalizeSlugInput } from "../utils/normalize-slug-input";
import { createWorkspaceSchema, type CreateWorkspaceInput } from "../schemas";

/**
 * Slug-only workspace creation form.
 *
 * Rendered by `routes/workspaces/create.tsx`. On success we remember the
 * new workspace as last-used (so a sign-out + sign-in cycle lands the user
 * here again) and navigate straight to its dashboard.
 *
 * The slug field normalizes on every keystroke via `normalizeSlugInput`, so
 * typing or pasting "Acme Corp" yields "acme-corp" instead of a validation
 * error. `createWorkspaceSchema` still runs on submit — it's the guard for what
 * normalization can't silently repair (too short, doesn't start with a letter).
 *
 * 409 slug-taken responses become inline field errors so the user can edit
 * and resubmit without losing context; everything else surfaces as a toast.
 */
export function CreateWorkspaceForm() {
  const navigate = useNavigate();
  const { mutate, isPending } = useCreateWorkspace();

  const form = useForm<CreateWorkspaceInput>({
    resolver: zodResolver(createWorkspaceSchema),
    defaultValues: { slug: "" },
  });

  const onSubmit = (values: CreateWorkspaceInput) => {
    mutate(values, {
      onSuccess: (result) => {
        toast.success("Workspace created");
        setLastWorkspaceId(result.workspaceId);
        navigate(`/dashboard/${result.workspaceId}`);
      },
      onError: (err) => {
        if (err instanceof ApiError && err.code === "slug_taken") {
          form.setError("slug", { message: "That slug is already taken" });
          return;
        }
        toast.error(err.message);
      },
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Workspace URL</FormLabel>
              <FormControl>
                <div className="flex items-center rounded-md border border-input bg-transparent focus-within:ring-1 focus-within:ring-ring">
                  <span className="border-r border-input bg-muted/30 px-3 py-1.5 text-sm text-muted-foreground">
                    chat.app/
                  </span>
                  <Input
                    className="border-0 shadow-none focus-visible:ring-0"
                    placeholder="acme"
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    {...field}
                    onChange={(event) =>
                      field.onChange(normalizeSlugInput(event.target.value))
                    }
                    onBlur={() => {
                      field.onChange(finalizeSlugInput(field.value));
                      field.onBlur();
                    }}
                  />
                </div>
              </FormControl>
              <FormDescription>
                Lowercase letters, numbers, and hyphens — spaces become hyphens. You
                can't change this later.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? "Creating…" : "Create workspace"}
        </Button>
      </form>
    </Form>
  );
}
