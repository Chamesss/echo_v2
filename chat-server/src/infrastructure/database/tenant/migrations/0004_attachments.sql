-- Tenant schema v4: message attachments (Sprint 7).
-- Fleshes out the stub `attachments` table (was `id, message_id, url`) into a
-- full file-manager row. Safe to add NOT NULL columns without a backfill: the
-- attachments feature never shipped, so the table is empty in every tenant.
-- Runs inside the per-tenant search_path set by migrate-tenants.ts.

ALTER TABLE attachments ADD COLUMN s3_key       text NOT NULL;
ALTER TABLE attachments ADD COLUMN filename     text NOT NULL;
ALTER TABLE attachments ADD COLUMN content_type text NOT NULL;
ALTER TABLE attachments ADD COLUMN size_bytes   bigint NOT NULL;
ALTER TABLE attachments ADD COLUMN category     text NOT NULL;
ALTER TABLE attachments ADD COLUMN created_at   timestamp with time zone NOT NULL DEFAULT now();
CREATE INDEX attachments_message_idx ON attachments (message_id);
