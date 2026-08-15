ALTER TABLE "watch_progress" ADD COLUMN "checkpoint_session_id" text;--> statement-breakpoint
ALTER TABLE "watch_progress" ADD COLUMN "checkpoint_sequence" integer;--> statement-breakpoint
ALTER TABLE "watch_progress" ADD COLUMN "checkpoint_updated_at" timestamp with time zone;