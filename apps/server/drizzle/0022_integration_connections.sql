CREATE TABLE "integration_connection" (
	"profile_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"account_name" text NOT NULL,
	"credentials_encrypted" text NOT NULL,
	"sync_cursor" text,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connection_profile_id_provider_pk" PRIMARY KEY("profile_id","provider"),
	CONSTRAINT "integration_connection_provider_check" CHECK ("integration_connection"."provider" in ('trakt', 'simkl', 'mdblist'))
);
--> statement-breakpoint
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;