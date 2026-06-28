import type { ReactNode } from "react";
import { toast } from "sonner";
import { Crown, ShieldCheck, ShieldOff, UserMinus } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import {
  useChangeMemberRole,
  useMembers,
  useRemoveMember,
  type MemberDTO,
} from "../api/use-members";

/**
 * Workspace member roster. Every member sees the list; admins additionally get
 * role + remove controls. The owner row is never actionable (the server also
 * enforces this), and admins can't act on their own row to avoid self-lockout.
 */
export function MembersTable({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const { data: session } = useSession();
  const currentUserId = session?.user.id;

  const { data: members, isPending } = useMembers(workspaceId);
  const changeRole = useChangeMemberRole(workspaceId);
  const removeMember = useRemoveMember(workspaceId);
  const busy = changeRole.isPending || removeMember.isPending;

  const handleToggleRole = (m: MemberDTO) => {
    const next = m.role === "admin" ? "member" : "admin";
    changeRole.mutate(
      { userId: m.userId, role: next },
      {
        onSuccess: () => toast.success(next === "admin" ? "Promoted to admin" : "Changed to member"),
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const handleRemove = (m: MemberDTO) => {
    if (!window.confirm(`Remove ${m.name || m.email} from this workspace?`)) return;
    removeMember.mutate(m.userId, {
      onSuccess: () => toast.success("Member removed"),
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Member</th>
            <th className="px-3 py-2 font-medium">Role</th>
            {canManage && <th className="px-3 py-2 text-right font-medium">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {isPending ? (
            <Row colSpan={canManage ? 3 : 2}>Loading members…</Row>
          ) : !members || members.length === 0 ? (
            <Row colSpan={canManage ? 3 : 2}>No members yet.</Row>
          ) : (
            members.map((m) => {
              const isSelf = m.userId === currentUserId;
              return (
                <tr key={m.userId} className="align-middle">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        {m.image && <AvatarImage src={m.image} alt={m.name} />}
                        <AvatarFallback>{initials(m.name || m.email)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">
                          {m.name || "—"}
                          {isSelf && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {m.isOwner ? (
                      <Badge tone="accent">
                        <Crown className="mr-1 size-3" /> Owner
                      </Badge>
                    ) : (
                      <Badge tone={m.role === "admin" ? "accent" : "muted"}>{m.role}</Badge>
                    )}
                  </td>
                  {canManage && (
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <IconButton
                          label={m.role === "admin" ? "Change to member" : "Make admin"}
                          disabled={busy || m.isOwner}
                          onClick={() => handleToggleRole(m)}
                        >
                          {m.role === "admin" ? <ShieldOff /> : <ShieldCheck />}
                        </IconButton>
                        <IconButton
                          label="Remove"
                          tone="danger"
                          disabled={busy || m.isOwner || isSelf}
                          onClick={() => handleRemove(m)}
                        >
                          <UserMinus />
                        </IconButton>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

function Row({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-6 text-center text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}

function Badge({ tone, children }: { tone: "accent" | "muted"; children: ReactNode }) {
  const tones = {
    accent: "bg-foreground/10 text-foreground",
    muted: "bg-muted text-muted-foreground",
  } as const;
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
  children: ReactNode;
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
      className={tone === "danger" ? "text-destructive hover:text-destructive" : undefined}
    >
      <span className="[&_svg]:size-4">{children}</span>
    </Button>
  );
}
