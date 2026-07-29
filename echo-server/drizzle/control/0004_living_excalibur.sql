-- Add the mutable workspace display name. Existing workspaces predate this
-- column, so add it nullable, backfill from the slug, then enforce NOT NULL.
ALTER TABLE "workspaces" ADD COLUMN "name" text;--> statement-breakpoint
UPDATE "workspaces" SET "name" = "slug" WHERE "name" IS NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "name" SET NOT NULL;
