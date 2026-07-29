ALTER TABLE "watch_progress" ADD COLUMN "media_id" text;--> statement-breakpoint
ALTER TABLE "watch_progress" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "watch_progress" ADD COLUMN "poster" text;--> statement-breakpoint
ALTER TABLE "watch_progress" ADD COLUMN "video_title" text;--> statement-breakpoint
ALTER TABLE "watch_progress" ADD COLUMN "season" integer;--> statement-breakpoint
ALTER TABLE "watch_progress" ADD COLUMN "episode" integer;--> statement-breakpoint
UPDATE "watch_progress" SET "media_id" = "video_id", "name" = "video_id";--> statement-breakpoint
ALTER TABLE "watch_progress" ALTER COLUMN "media_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "watch_progress" ALTER COLUMN "name" SET NOT NULL;
