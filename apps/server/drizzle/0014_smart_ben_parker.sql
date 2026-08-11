ALTER TABLE "watch_progress" ADD COLUMN "continue_watching" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "watch_progress"
SET "continue_watching" = true
WHERE "watched" = true OR "position_ms" >= 30000;
