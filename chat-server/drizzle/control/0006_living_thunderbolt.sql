CREATE TABLE "notification_settings" (
	"user_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "notification_settings_user_id_workspace_id_pk" PRIMARY KEY("user_id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "channel_name" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "important" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;