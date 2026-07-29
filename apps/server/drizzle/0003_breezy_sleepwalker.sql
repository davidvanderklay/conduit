CREATE TABLE "instance_setting" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"registration_mode" text DEFAULT 'closed' NOT NULL,
	"oidc_enabled" boolean DEFAULT false NOT NULL,
	"oidc_issuer" text,
	"oidc_client_id" text,
	"oidc_client_secret_encrypted" text,
	"oidc_display_name" text DEFAULT 'Single sign-on' NOT NULL,
	"oidc_scopes" text DEFAULT 'openid email' NOT NULL,
	"oidc_auto_register" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "recovery_code_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "recovery_code" ADD CONSTRAINT "recovery_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recovery_code_user_idx" ON "recovery_code" USING btree ("user_id");--> statement-breakpoint
INSERT INTO "instance_setting" ("id") VALUES ('default') ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "user" SET "role" = 'owner'
WHERE "id" = (SELECT "id" FROM "user" ORDER BY "created_at" ASC LIMIT 1);
