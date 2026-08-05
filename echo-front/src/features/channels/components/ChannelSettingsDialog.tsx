import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { LogOut, Trash2, UserMinus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { paths } from "@/lib/paths";
import { useSession } from "@/lib/auth-client";
import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";
import { useMembers } from "@/features/members/api/use-members";
import type { ChannelDTO } from "../api/use-channels";
import type { DirectMessageDTO } from "../api/use-dms";
import {
  useAddChannelMember,
  useChannelMembers,
  useDeleteChannel,
  useLeaveChannel,
  useRemoveChannelMember,
  useUpdateChannel,
} from "../api/use-channel-admin";

/**
 * Channel settings modal: rename / topic / archive / delete (admin or creator),
 * private-channel member management (any member may add; admin/creator may
 * remove), and leave (any member). Archive/delete/leave navigate back to the
 * workspace home since the channel becomes inaccessible from the list.
 */
export function ChannelSettingsDialog({
  channel,
  onClose,
}: {
  channel: ChannelDTO | DirectMessageDTO;
  onClose: () => void;
}) {
  const workspace = useCurrentWorkspace();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const myId = session?.user.id;

  const isGroup = channel.type === "group";

  /**
   * Who may change this.
   *
   * A channel is an organisational object, so a workspace admin owns it whether
   * or not they joined. A group conversation is not — it belongs to the people
   * in it, and a workspace role grants nothing. The server enforces the same
   * split; this only decides what to render.
   */
  const canManage = isGroup
    ? channel.isMember
    : workspace.role === "admin" || channel.createdBy === myId;

  // No per-channel roles exist, so the person who started a group is its only
  // authority for evicting someone else. Anyone can still leave.
  const canRemoveOthers = isGroup ? channel.createdBy === myId : canManage;

  // Close on Escape for keyboard users.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const goHome = () => {
    onClose();
    navigate(paths.workspace(workspace.id));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Channel settings"
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <h2 className="font-semibold text-foreground">
            {isGroup ? "Conversation settings" : "Channel settings"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="space-y-6 overflow-y-auto p-4">
          {canManage && <DetailsSection channel={channel} isGroup={isGroup} />}

          {(channel.type === "private" || isGroup) && (
            <MembersSection
              channel={channel}
              canAdd={canManage}
              canRemove={canRemoveOthers}
              isGroup={isGroup}
            />
          )}

          <LeaveSection
            channelId={channel.id}
            isGroup={isGroup}
            onLeft={goHome}
          />

          {/* No danger zone for a conversation: archiving would hide it from
              everyone with no way back, and deleting is blocked server-side.
              Leaving is the exit. */}
          {canManage && !isGroup && (
            <DangerSection
              channel={channel}
              onArchived={goHome}
              onDeleted={goHome}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

function DetailsSection({
  channel,
  isGroup,
}: {
  channel: ChannelDTO | DirectMessageDTO;
  isGroup: boolean;
}) {
  const workspace = useCurrentWorkspace();
  const update = useUpdateChannel(workspace.id);

  // A group's `name` is a DERIVED label when it hasn't been given one, so the
  // form edits `customName` and shows the label as a placeholder. Editing
  // `name` directly would turn "currently showing Alice, Bob" into a real
  // title the moment anyone pressed Save.
  const stored = isGroup
    ? ((channel as DirectMessageDTO).customName ?? "")
    : (channel.name ?? "");
  const [name, setName] = useState(stored);
  const [topic, setTopic] = useState(channel.topic ?? "");

  const dirty =
    name.trim() !== stored || topic.trim() !== (channel.topic ?? "");

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed && !isGroup) {
      toast.error("Name can't be empty");
      return;
    }
    update.mutate(
      {
        channelId: channel.id,
        // Empty on a group clears it, restoring the participant label.
        name: trimmed || null,
        topic: topic.trim(),
      },
      {
        onSuccess: () =>
          toast.success(isGroup ? "Conversation updated" : "Channel updated"),
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <section>
      <SectionTitle>Details</SectionTitle>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm text-muted-foreground">
            Name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-muted-foreground">
            Topic
          </label>
          <Input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={280}
            placeholder="What's this channel about?"
          />
        </div>
        <Button size="sm" disabled={!dirty || update.isPending} onClick={save}>
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </section>
  );
}

function MembersSection({
  channel,
  canAdd,
  canRemove,
  isGroup,
}: {
  channel: ChannelDTO | DirectMessageDTO;
  /** Any member may bring someone in. */
  canAdd: boolean;
  /** Evicting someone else is narrower — see `canRemoveOthers`. */
  canRemove: boolean;
  isGroup: boolean;
}) {
  const workspace = useCurrentWorkspace();
  const { data: members = [] } = useChannelMembers(workspace.id, channel.id);
  const { data: roster = [] } = useMembers(workspace.id);
  const add = useAddChannelMember(workspace.id, channel.id);
  const remove = useRemoveChannelMember(workspace.id, channel.id);
  const [selected, setSelected] = useState("");

  const memberIds = new Set(members.map((m) => m.userId));
  const candidates = roster.filter((m) => !memberIds.has(m.userId));

  const handleAdd = () => {
    if (!selected) return;
    add.mutate(selected, {
      onSuccess: () => {
        toast.success("Member added");
        setSelected("");
      },
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <section>
      <SectionTitle>{isGroup ? "People" : "Members"}</SectionTitle>
      {canAdd && (
        <div className="mb-3 flex gap-2 items-center">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            aria-label={
              isGroup ? "Add someone to this conversation" : "Add a member"
            }
            // `min-w-0` is load-bearing. A flex item defaults to
            // `min-width: auto`, which refuses to shrink below its intrinsic
            // width — and a <select>'s intrinsic width comes from its WIDEST
            // <option>, not the selected one. One person with a long name and
            // address therefore set a floor under this row and stretched the
            // dialog past its `max-w-md`. `flex-1` can't help: it grants grow,
            // not shrink. `truncate` then ellipses the chosen value instead of
            // clipping it mid-character. The open dropdown is a native overlay,
            // so it still shows each option in full.
            className="flex h-9 min-w-0 flex-1 truncate rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">
              {isGroup ? "Add someone…" : "Add a member…"}
            </option>
            {candidates.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name} ({m.email})
              </option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={!selected || add.isPending}
            onClick={handleAdd}
          >
            Add
          </Button>
        </div>
      )}
      <ul className="divide-y divide-border rounded-md border border-border">
        {members.map((m) => (
          <li
            key={m.userId}
            className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
          >
            <span className="min-w-0 truncate">
              <span className="font-medium text-foreground">{m.name}</span>{" "}
              <span className="text-muted-foreground">{m.email}</span>
            </span>
            {canRemove && (
              <Button
                variant="ghost"
                size="sm"
                // The name beside it truncates, so this keeps its full hit
                // target instead of being squeezed by a long address.
                className="shrink-0 text-destructive hover:text-destructive"
                disabled={remove.isPending}
                title={
                  isGroup ? "Remove from conversation" : "Remove from channel"
                }
                aria-label={`Remove ${m.name}`}
                onClick={() =>
                  remove.mutate(m.userId, {
                    onError: (err) => toast.error(err.message),
                  })
                }
              >
                <UserMinus className="size-4" />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function LeaveSection({
  channelId,
  isGroup,
  onLeft,
}: {
  channelId: string;
  isGroup: boolean;
  onLeft: () => void;
}) {
  const workspace = useCurrentWorkspace();
  const leave = useLeaveChannel(workspace.id);
  return (
    <section>
      <SectionTitle>Membership</SectionTitle>
      <Button
        variant="outline"
        size="sm"
        disabled={leave.isPending}
        onClick={() =>
          leave.mutate(channelId, {
            onSuccess: () => {
              toast.success(
                isGroup ? "You left the conversation" : "You left the channel",
              );
              onLeft();
            },
            onError: (err) => toast.error(err.message),
          })
        }
      >
        <LogOut /> {isGroup ? "Leave conversation" : "Leave channel"}
      </Button>
    </section>
  );
}

function DangerSection({
  channel,
  onArchived,
  onDeleted,
}: {
  channel: ChannelDTO;
  onArchived: () => void;
  onDeleted: () => void;
}) {
  const workspace = useCurrentWorkspace();
  const update = useUpdateChannel(workspace.id);
  const del = useDeleteChannel(workspace.id);

  const archive = () => {
    update.mutate(
      { channelId: channel.id, archived: true },
      {
        onSuccess: () => {
          toast.success("Channel archived");
          onArchived();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const remove = () => {
    if (
      !window.confirm(
        `Permanently delete #${channel.name}? This can't be undone.`,
      )
    )
      return;
    del.mutate(channel.id, {
      onSuccess: () => {
        toast.success("Channel deleted");
        onDeleted();
      },
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <section className="rounded-md border border-destructive/40 p-3">
      <SectionTitle>Danger zone</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={update.isPending}
          onClick={archive}
        >
          Archive
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={del.isPending}
          onClick={remove}
        >
          <Trash2 /> Delete
        </Button>
      </div>
    </section>
  );
}
