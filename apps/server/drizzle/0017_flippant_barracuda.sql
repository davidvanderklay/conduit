CREATE TABLE "playback_queue_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"media_type" text NOT NULL,
	"media_id" text NOT NULL,
	"video_id" text NOT NULL,
	"name" text NOT NULL,
	"poster" text,
	"artwork" text,
	"video_title" text,
	"season" integer,
	"episode" integer,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playback_queue_media_type_check" CHECK ("playback_queue_item"."media_type" in ('movie', 'series'))
);
--> statement-breakpoint
ALTER TABLE "playback_queue_item" ADD CONSTRAINT "playback_queue_item_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "playback_queue_profile_item_idx" ON "playback_queue_item" USING btree ("profile_id","media_type","media_id","video_id");--> statement-breakpoint
CREATE INDEX "playback_queue_profile_position_idx" ON "playback_queue_item" USING btree ("profile_id","position");