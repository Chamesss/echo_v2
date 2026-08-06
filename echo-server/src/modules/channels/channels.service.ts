import { withTenantSchema } from "../../infrastructure/database/tenant/client.js";
import {
  emitWorkspaceEvent,
  RealtimeEvents,
} from "../../infrastructure/realtime/events.js";
import { revokeChannelNotifications } from "../notifications/notifications.service.js";
import {
  assertCanManageChannel,
  assertGroupMember,
  isConversation,
  loadChannelGate,
  type ChannelActor,
} from "./channels.gates.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../shared/errors/app-error.js";
import { ErrorCode } from "../../shared/errors/error-codes.js";
import type { CreateChannelBody } from "./channels.dto.js";

/**
 * Channel business logic. All persistence runs through `withTenantSchema`, so
 * unqualified table names resolve to the caller's workspace schema. The control
 * tables (`users`, `memberships`) live in `public`, which is also on the
 * search_path, so a tenant query can join to them directly.
 *
 * Access model: participating in a channel — reading, subscribing, posting —
 * requires a `channel_members` row. Public channels are open-join; private
 * channels are managed (members are added by a channel member). MANAGEMENT of a
 * channel (rename / set topic / archive / delete / remove members) requires
 * being a workspace admin OR the channel's creator.
 *
 * The rules ENFORCING that model live in `channels.gates.ts`, and membership
 * operations in `channels.members.ts`; this file is the channel lifecycle
 * (list/create/get/update/delete) plus the DTO the others return.
 */
export interface ChannelDTO {
  id: string;
  type: "public" | "private" | "direct" | "group";
  name: string | null;
  topic: string | null;
  archived: boolean;
  createdBy: string | null;
  lastSeq: number;
  isMember: boolean;
  unread: number;
  createdAt: string;
}

interface ChannelRow {
  id: string;
  type: ChannelDTO["type"];
  name: string | null;
  topic: string | null;
  archived: boolean;
  created_by: string | null;
  last_seq: number;
  created_at: Date;
  last_read_seq: number | null;
  is_member: boolean;
}

/** Columns + membership computed against `$1 = userId`, shared by the read queries. */
const CHANNEL_SELECT = `
  c.id, c.type, c.name, c.topic, c.archived, c.created_by, c.last_seq, c.created_at,
  cm.last_read_seq,
  (cm.user_id IS NOT NULL) AS is_member`;


function toDTO(row: ChannelRow): ChannelDTO {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    topic: row.topic,
    archived: row.archived,
    createdBy: row.created_by,
    lastSeq: row.last_seq,
    isMember: row.is_member,
    unread: row.is_member ? Math.max(0, row.last_seq - (row.last_read_seq ?? 0)) : 0,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Named channels the user can see: every public channel + private ones they're
 * in. Hides archived. DMs (`direct`/`group`) are intentionally excluded — they
 * have their own listing (see `dm.service.ts#listDirectMessages`).
 */
export async function listChannels(workspaceId: string, userId: string): Promise<ChannelDTO[]> {
  return withTenantSchema(workspaceId, async (db) => {
    const { rows } = await db.query<ChannelRow>(
      `SELECT ${CHANNEL_SELECT}
         FROM channels c
         LEFT JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $1
        WHERE c.archived = false
          AND c.type IN ('public', 'private')
          AND (c.type = 'public' OR cm.user_id IS NOT NULL)
        ORDER BY c.created_at ASC, c.id ASC`,
      [userId],
    );
    return rows.map(toDTO);
  });
}

export async function createChannel(
  workspaceId: string,
  userId: string,
  input: CreateChannelBody,
): Promise<ChannelDTO> {
  const channel = await withTenantSchema(workspaceId, async (db) => {
    const { rows } = await db.query<ChannelRow>(
      `INSERT INTO channels (type, name, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, type, name, topic, archived, created_by, last_seq, created_at,
                 0 AS last_read_seq, true AS is_member`,
      [input.type, input.name, userId],
    );
    const row = rows[0]!;
    await db.query(`INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)`, [
      row.id,
      userId,
    ]);
    return toDTO(row);
  });

  // Tell the workspace a channel now exists so live clients show it without a
  // reload (a private channel's id is harmless to broadcast — non-members' list
  // refetch won't include it).
  await emitWorkspaceEvent(workspaceId, RealtimeEvents.channelCreated(channel.id));
  return channel;
}

/** Open-join a public channel. Private channels are managed (403); archived channels can't be joined. */
export async function joinChannel(
  workspaceId: string,
  userId: string,
  channelId: string,
): Promise<ChannelDTO> {
  const channel = await withTenantSchema(workspaceId, async (db) => {
    const { rows } = await db.query<ChannelRow>(
      `SELECT c.id, c.type, c.name, c.topic, c.archived, c.created_by, c.last_seq, c.created_at,
              NULL::int AS last_read_seq, false AS is_member
         FROM channels c WHERE c.id = $1`,
      [channelId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("Channel not found", ErrorCode.ChannelNotFound);
    if (row.archived) {
      throw new ForbiddenError("This channel is archived", ErrorCode.ChannelArchived);
    }
    if (row.type !== "public") {
      throw new ForbiddenError("This channel is invite-only", ErrorCode.NotAChannelMember);
    }
    // Start the joiner caught up to the join point — they didn't "miss" the
    // pre-existing history, so it shouldn't show as unread. Only messages sent
    // after they join count toward their unread.
    await db.query(
      `INSERT INTO channel_members (channel_id, user_id, last_read_seq) VALUES ($1, $2, $3)
       ON CONFLICT (channel_id, user_id) DO NOTHING`,
      [channelId, userId, row.last_seq],
    );
    return toDTO({ ...row, is_member: true, last_read_seq: row.last_seq });
  });

  // Member set changed → others re-read the channel's member list.
  await emitWorkspaceEvent(workspaceId, RealtimeEvents.channelUpdated(channelId));
  return channel;
}

export async function getChannel(
  workspaceId: string,
  userId: string,
  channelId: string,
): Promise<ChannelDTO> {
  return withTenantSchema(workspaceId, async (db) => {
    const { rows } = await db.query<ChannelRow>(
      `SELECT ${CHANNEL_SELECT}
         FROM channels c
         LEFT JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $2
        WHERE c.id = $1`,
      [channelId, userId],
    );
    const channel = rows[0];
    if (!channel) throw new NotFoundError("Channel not found", ErrorCode.ChannelNotFound);
    // Only public channels are visible to non-members; private channels and DMs
    // (direct/group) require a membership row.
    if (channel.type !== "public" && !channel.is_member) {
      throw new ForbiddenError("You don't have access to this channel", ErrorCode.NotAChannelMember);
    }
    return toDTO(channel);
  });
}

// ─── Management ─────────────────────────────────────────────────────────────

export interface UpdateChannelInput {
  /** `null` clears it — groups only, restoring their participant-derived label. */
  name?: string | null;
  topic?: string | null;
  archived?: boolean;
}

/** Rename / set topic / archive a channel. */
export async function updateChannel(
  workspaceId: string,
  channelId: string,
  actor: ChannelActor,
  input: UpdateChannelInput,
): Promise<ChannelDTO> {
  const channel = await withTenantSchema(workspaceId, async (db) => {
    const gate = await loadChannelGate(db, channelId, actor.userId);
    if (gate.type === "direct") {
      // A 1:1 is labelled by who's in it; there is nothing to rename, and
      // archiving would hide it from both people with no way back.
      throw new ForbiddenError(
        "Direct messages can't be renamed or archived",
        ErrorCode.NotAllowedOnConversation,
      );
    }
    if (gate.type === "group") {
      assertGroupMember(gate);
      if (input.archived !== undefined) {
        // Archiving drops a conversation out of BOTH list endpoints while
        // leaving it readable by id, with no UI to bring it back. Leaving is
        // the exit from a group.
        throw new ForbiddenError(
          "Conversations can't be archived — leave it instead",
          ErrorCode.NotAllowedOnConversation,
        );
      }
    } else {
      await assertCanManageChannel(db, channelId, actor);
      if (input.name === null) {
        // Only a group has a name to fall back FROM.
        throw new BadRequestError("A channel needs a name", ErrorCode.BadRequest);
      }
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.name !== undefined) sets.push(`name = $${params.push(input.name)}`);
    if (input.topic !== undefined) sets.push(`topic = $${params.push(input.topic)}`);
    if (input.archived !== undefined) sets.push(`archived = $${params.push(input.archived)}`);
    // The DTO guarantees at least one field, so `sets` is never empty.

    // Membership / read-state for the returned DTO is computed against the actor.
    const actorParam = params.push(actor.userId);
    const idParam = params.push(channelId);

    const { rows } = await db.query<ChannelRow>(
      `WITH updated AS (
         UPDATE channels AS c SET ${sets.join(", ")} WHERE c.id = $${idParam}
         RETURNING c.id, c.type, c.name, c.topic, c.archived, c.created_by, c.last_seq, c.created_at
       )
       SELECT u.id, u.type, u.name, u.topic, u.archived, u.created_by, u.last_seq, u.created_at,
              cm.last_read_seq, (cm.user_id IS NOT NULL) AS is_member
         FROM updated u
         LEFT JOIN channel_members cm ON cm.channel_id = u.id AND cm.user_id = $${actorParam}`,
      params,
    );
    return toDTO(rows[0]!);
  });

  // Name/topic/archived changed → live clients re-read the channel.
  await emitWorkspaceEvent(workspaceId, RealtimeEvents.channelUpdated(channel.id));
  return channel;
}

/** Hard-delete a channel (cascades messages, members, revisions, attachments). */
export async function deleteChannel(
  workspaceId: string,
  channelId: string,
  actor: ChannelActor,
): Promise<void> {
  await withTenantSchema(workspaceId, async (db) => {
    const gate = await loadChannelGate(db, channelId, actor.userId);
    if (isConversation(gate.type)) {
      // Nobody deletes a conversation — not the other participant, and not a
      // workspace admin, who can't even read it. Leaving is the exit.
      throw new ForbiddenError(
        "Conversations can't be deleted",
        ErrorCode.NotAllowedOnConversation,
      );
    }
    await assertCanManageChannel(db, channelId, actor);
    await db.query(`DELETE FROM channels WHERE id = $1`, [channelId]);
  });

  // The channel's rows cascade inside the tenant schema, but notifications live
  // in the control plane with no FK to them — nobody can open this channel now,
  // so nobody should still have an inbox entry pointing at it.
  await revokeChannelNotifications(channelId);

  // Drop it from every live client's list (and bounce anyone viewing it).
  await emitWorkspaceEvent(workspaceId, RealtimeEvents.channelDeleted(channelId));
}
