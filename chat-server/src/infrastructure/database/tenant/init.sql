-- Tenant schema bootstrap. Executed inside the provisioning transaction in
-- `infrastructure/provisioning/workspace.ts` after CREATE SCHEMA + SET LOCAL
-- search_path. All identifiers are unqualified so they land in the active
-- per-workspace schema.
--
-- Versioning model (see modules/channels + the plan): `channels.last_seq` is a
-- per-channel monotonic CHANGE CLOCK, bumped on every event (message create,
-- edit, delete). Each message stores `seq` (creation ordinal, immutable — used
-- for stable ordering + history pagination) and `updated_seq` (clock at last
-- mutation — the reconciliation key clients catch up on via
-- `GET .../messages?since=<clock>`). WebSocket delivery is best-effort; this
-- clock is the source of truth.

CREATE TABLE channels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type        text NOT NULL CHECK (type IN ('public', 'private', 'direct', 'group')),
  name        text,
  dm_key      text,
  -- Monotonic per-channel change clock. Bumped under a row lock on every
  -- message create/edit/delete so sequences are gapless.
  last_seq    integer NOT NULL DEFAULT 0,
  created_at  timestamp with time zone NOT NULL DEFAULT now()
);
-- dm_key is NULL for named channels; Postgres treats each NULL as distinct, so
-- this only enforces uniqueness among direct/group channels.
CREATE UNIQUE INDEX channels_dm_key_unique ON channels (dm_key);

CREATE TABLE channel_members (
  channel_id    uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  -- text, not uuid: FKs logically to control.users.id, which Better Auth
  -- generates as a non-UUID string.
  user_id       text NOT NULL,
  last_read_seq integer NOT NULL DEFAULT 0,
  joined_at     timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX channel_members_user_idx ON channel_members (user_id);

CREATE TABLE messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id   text NOT NULL,
  body        text NOT NULL,
  -- Client-generated idempotency key: a retried send with the same client_id
  -- returns the existing row instead of inserting a duplicate / burning a seq.
  client_id   uuid NOT NULL,
  -- Creation ordinal (clock value at insert). Immutable → stable ordering.
  seq         integer NOT NULL,
  -- Clock value at the last mutation (create/edit/delete). Catch-up key.
  updated_seq integer NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  deleted     boolean NOT NULL DEFAULT false,
  created_at  timestamp with time zone NOT NULL DEFAULT now(),
  updated_at  timestamp with time zone
);
CREATE UNIQUE INDEX messages_channel_seq_unique         ON messages (channel_id, seq);
CREATE UNIQUE INDEX messages_channel_client_id_unique   ON messages (channel_id, client_id);
-- Catch-up scans: "everything in this channel changed after <clock>".
CREATE INDEX        messages_channel_updated_seq_idx     ON messages (channel_id, updated_seq);

CREATE TABLE message_revisions (
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  version     integer NOT NULL,
  body        text NOT NULL,
  edited_at   timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, version)
);

CREATE TABLE attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  url         text NOT NULL
);
