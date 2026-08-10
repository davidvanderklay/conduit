CREATE TABLE IF NOT EXISTS "rate_limit_entry" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limit_entry_reset_idx" ON "rate_limit_entry" USING btree ("reset_at");
