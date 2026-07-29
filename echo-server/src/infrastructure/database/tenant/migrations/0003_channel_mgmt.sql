-- Tenant schema v3: channel management.
-- Adds a topic/description, an archived flag (archived channels stay readable
-- but drop out of the channel list), and the creator id (text → control.users.id)
-- that powers the "admin or creator can manage" authorization rule.
-- Runs inside the per-tenant search_path set by migrate-tenants.ts.

ALTER TABLE channels ADD COLUMN topic text;
ALTER TABLE channels ADD COLUMN archived boolean NOT NULL DEFAULT false;
ALTER TABLE channels ADD COLUMN created_by text;
