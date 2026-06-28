CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_id" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");