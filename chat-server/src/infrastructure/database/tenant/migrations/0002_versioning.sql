-- Tenant schema migration v1 → v2 (messaging / sequence versioning).
--
-- Applied to each existing tenant_<slug> schema by `scripts/migrate-tenants.ts`
-- with search_path already set to that schema. New tenants skip this — they're
-- provisioned directly from the current `init.sql`. Written to be idempotent
-- (IF EXISTS / IF NOT EXISTS) so a re-run is safe.

-- 1. User references are Better Auth text ids, not UUIDs.
ALTER TABLE channel_members ALTER COLUMN user_id TYPE text USING user_id::text;
ALTER TABLE messages        ALTER COLUMN author_id TYPE text USING author_id::text;

-- 2. Timestamps + the change-clock reconciliation column.
ALTER TABLE channels        ADD COLUMN IF NOT EXISTS created_at  timestamptz NOT NULL DEFAULT now();
ALTER TABLE channel_members ADD COLUMN IF NOT EXISTS joined_at   timestamptz NOT NULL DEFAULT now();
ALTER TABLE messages        ADD COLUMN IF NOT EXISTS created_at  timestamptz NOT NULL DEFAULT now();
ALTER TABLE messages        ADD COLUMN IF NOT EXISTS updated_at  timestamptz;
ALTER TABLE messages        ADD COLUMN IF NOT EXISTS updated_seq integer NOT NULL DEFAULT 0;

-- Backfill: existing rows have never been edited, so their change-clock equals
-- their creation ordinal.
UPDATE messages SET updated_seq = seq WHERE updated_seq = 0;

-- 3. Catch-up scan index.
CREATE INDEX IF NOT EXISTS messages_channel_updated_seq_idx ON messages (channel_id, updated_seq);
