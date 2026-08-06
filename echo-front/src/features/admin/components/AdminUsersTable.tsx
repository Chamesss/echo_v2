import { useEffect, useState } from "react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import {
  Ban,
  LogIn,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/auth-client";
import {
  useAdminUsers,
  useBanUser,
  useImpersonateUser,
  useRemoveUser,
  useSetRole,
  useUnbanUser,
} from "../api/use-admin-users";

const PAGE_SIZE = 20;

/**
 * Admin user-management table: search, paginate, and act on users.
 *
 * Destructive/irreversible actions (delete) confirm first; ban optionally
 * captures a reason. Actions that would let an admin lock themselves out
 * (ban/delete/impersonate/demote on their own row) are disabled for the
 * current user. Every action is still authorized server-side — this is just
 * the UI affordance.
 */
export function AdminUsersTable() {
  const { data: session } = useSession();
  const currentUserId = session?.user.id;

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);

  // Debounce the search box so we don't hit the server on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isPending, isFetching } = useAdminUsers({
    search,
    limit: PAGE_SIZE,
    offset,
  });
  const setRole = useSetRole();
  const banUser = useBanUser();
  const unbanUser = useUnbanUser();
  const removeUser = useRemoveUser();
  const impersonate = useImpersonateUser();

  const users = data?.users ?? [];
  const total = data?.total ?? 0;

  const handleToggleRole = (id: string, isAdmin: boolean) => {
    setRole.mutate(
      { userId: id, role: isAdmin ? "user" : "admin" },
      {
        onSuccess: () =>
          toast.success(isAdmin ? "Demoted to user" : "Promoted to admin"),
        onError: toastError,
      },
    );
  };

  const handleBan = (id: string) => {
    const reason = window.prompt("Ban reason (optional):") ?? undefined;
    banUser.mutate(
      { userId: id, banReason: reason || undefined },
      {
        onSuccess: () => toast.success("User banned"),
        onError: toastError,
      },
    );
  };

  const handleUnban = (id: string) => {
    unbanUser.mutate(
      { userId: id },
      {
        onSuccess: () => toast.success("User unbanned"),
        onError: toastError,
      },
    );
  };

  const handleImpersonate = (id: string) => {
    impersonate.mutate(
      { userId: id },
      {
        // Full reload so every session-derived bit of state re-renders as the
        // impersonated user.
        onSuccess: () => window.location.assign("/"),
        onError: toastError,
      },
    );
  };

  const handleDelete = (id: string, email: string) => {
    if (!window.confirm(`Permanently delete ${email}? This cannot be undone.`))
      return;
    removeUser.mutate(
      { userId: id },
      {
        onSuccess: () => toast.success("User deleted"),
        onError: toastError,
      },
    );
  };

  const busy =
    setRole.isPending ||
    banUser.isPending ||
    unbanUser.isPending ||
    removeUser.isPending ||
    impersonate.isPending;

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search by email…"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        className="max-w-sm"
      />

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">User</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isPending ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  Loading users…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  No users found.
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const isAdmin = u.role === "admin";
                const isSelf = u.id === currentUserId;

                return (
                  <tr key={u.id} className="align-middle">
                    <td className="px-3 py-2">
                      <div className="font-medium text-foreground">
                        {u.name || "—"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {u.email}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={isAdmin ? "accent" : "muted"}>
                        {u.role ?? "user"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      {u.banned ? (
                        <Badge tone="danger">Banned</Badge>
                      ) : (
                        <Badge tone="success">Active</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <IconButton
                          label={isAdmin ? "Make user" : "Make admin"}
                          disabled={busy || (isSelf && isAdmin)}
                          onClick={() => handleToggleRole(u.id, isAdmin)}
                        >
                          {isAdmin ? <ShieldOff /> : <ShieldCheck />}
                        </IconButton>

                        {u.banned ? (
                          <IconButton
                            label="Unban"
                            disabled={busy}
                            onClick={() => handleUnban(u.id)}
                          >
                            <Undo2 />
                          </IconButton>
                        ) : (
                          <IconButton
                            label="Ban"
                            disabled={busy || isSelf}
                            onClick={() => handleBan(u.id)}
                          >
                            <Ban />
                          </IconButton>
                        )}

                        <IconButton
                          label="Impersonate"
                          disabled={busy || isSelf}
                          onClick={() => handleImpersonate(u.id)}
                        >
                          <LogIn />
                        </IconButton>

                        <IconButton
                          label="Delete"
                          tone="danger"
                          disabled={busy || isSelf}
                          onClick={() => handleDelete(u.id, u.email)}
                        >
                          <Trash2 />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total > 0
            ? `Showing ${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total}`
            : "—"}
          {isFetching && " · refreshing…"}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "accent" | "muted" | "success" | "danger";
  children: React.ReactNode;
}) {
  const tones: Record<typeof tone, string> = {
    accent: "bg-foreground/10 text-foreground",
    muted: "bg-muted text-muted-foreground",
    success: "bg-success/15 text-success",
    danger: "bg-destructive/15 text-destructive",
  };
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium capitalize ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function IconButton({
  label,
  tone,
  disabled,
  onClick,
  children,
}: {
  label: string;
  tone?: "danger";
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={
        tone === "danger"
          ? "text-destructive hover:text-destructive"
          : undefined
      }
    >
      <span className="[&_svg]:size-4">{children}</span>
    </Button>
  );
}
