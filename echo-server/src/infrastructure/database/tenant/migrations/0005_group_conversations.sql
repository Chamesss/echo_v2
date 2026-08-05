-- Tenant schema v5: group conversations.
--
-- Two jobs. First, REPAIR: the DM feature added `dm_key` and widened the `type`
-- CHECK to include 'direct'/'group' by editing init.sql in place, without a
-- numbered migration and without bumping the version. Fresh tenants got both;
-- any tenant provisioned earlier and upgraded through this ladder still reports
-- v4 while lacking the column and rejecting DM inserts outright. Everything here
-- is written IF-NOT-EXISTS style so it is a no-op on schemas that already have it.
--
-- Second, POLICY: `dm_key` is the answer to "do these people already have a
-- conversation?". That question only has an answer while the member set is
-- fixed, which is true for a 1:1 and no longer true for a group — groups are now
-- mutable and carry their own name, so they are distinct entities rather than a
-- function of who is in them. Groups therefore stop being keyed, and picking the
-- same people twice creates two conversations, deliberately.
--
-- Runs inside the per-tenant search_path set by migrate-tenants.ts.

-- 1. The column the ladder never added.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS dm_key text;

-- 2. Widen the type CHECK. Dropped by name and re-added, because a tenant that
--    predates DMs still carries the two-value version, which rejects every DM.
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_type_check;
ALTER TABLE channels ADD CONSTRAINT channels_type_check
  CHECK (type IN ('public', 'private', 'direct', 'group'));

-- 3. Unkey every group. Multiple NULLs are allowed in a Postgres unique index,
--    so groups simply stop participating in open-or-create resolution.
UPDATE channels SET dm_key = NULL WHERE type = 'group';

-- 4. The index the ladder never added (after step 3, so it can't trip over
--    pre-existing duplicate group keys).
CREATE UNIQUE INDEX IF NOT EXISTS channels_dm_key_unique ON channels (dm_key);
