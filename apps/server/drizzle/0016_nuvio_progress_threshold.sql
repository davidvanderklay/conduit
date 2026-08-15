UPDATE "watch_progress"
SET "continue_watching" = true
WHERE "watched" = true OR "position_ms" >= 1000;
