CREATE TABLE "watch_party" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_user_id" text NOT NULL,
	"host_profile_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"media" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch_party_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"party_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watch_party_invite_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "watch_party_member" (
	"party_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "watch_party_member_party_id_profile_id_pk" PRIMARY KEY("party_id","profile_id")
);
--> statement-breakpoint
ALTER TABLE "watch_party" ADD CONSTRAINT "watch_party_host_user_id_user_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_party" ADD CONSTRAINT "watch_party_host_profile_id_profile_id_fk" FOREIGN KEY ("host_profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_party_invite" ADD CONSTRAINT "watch_party_invite_party_id_watch_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."watch_party"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_party_invite" ADD CONSTRAINT "watch_party_invite_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_party_member" ADD CONSTRAINT "watch_party_member_party_id_watch_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."watch_party"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_party_member" ADD CONSTRAINT "watch_party_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_party_member" ADD CONSTRAINT "watch_party_member_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "watch_party_host_idx" ON "watch_party" USING btree ("host_user_id");--> statement-breakpoint
CREATE INDEX "watch_party_status_expiry_idx" ON "watch_party" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "watch_party_invite_party_idx" ON "watch_party_invite" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "watch_party_invite_expiry_idx" ON "watch_party_invite" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "watch_party_member_user_idx" ON "watch_party_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "watch_party_member_party_idx" ON "watch_party_member" USING btree ("party_id","left_at");
