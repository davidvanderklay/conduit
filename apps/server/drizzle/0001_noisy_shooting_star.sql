CREATE TABLE "library_item" (
	"profile_id" uuid NOT NULL,
	"media_type" text NOT NULL,
	"media_id" text NOT NULL,
	"name" text NOT NULL,
	"poster" text,
	"background" text,
	"description" text,
	"release_info" text,
	"runtime" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_item_profile_id_media_type_media_id_pk" PRIMARY KEY("profile_id","media_type","media_id"),
	CONSTRAINT "library_item_media_type_check" CHECK ("library_item"."media_type" in ('movie', 'series'))
);
--> statement-breakpoint
ALTER TABLE "library_item" ADD CONSTRAINT "library_item_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_item_profile_created_idx" ON "library_item" USING btree ("profile_id","created_at");