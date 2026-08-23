CREATE TABLE "progress_applied_operation" (
	"profile_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"generation" integer NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "progress_applied_operation_profile_id_operation_id_pk" PRIMARY KEY("profile_id","operation_id")
);
--> statement-breakpoint
CREATE TABLE "progress_canonical_title" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"media_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress_event" (
	"profile_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"generation" integer NOT NULL,
	"operation_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "progress_event_profile_id_revision_pk" PRIMARY KEY("profile_id","revision")
);
--> statement-breakpoint
CREATE TABLE "progress_sync_state" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress_title_alias" (
	"profile_id" uuid NOT NULL,
	"media_type" text NOT NULL,
	"alias" text NOT NULL,
	"canonical_title_id" uuid NOT NULL,
	CONSTRAINT "progress_title_alias_profile_id_media_type_alias_pk" PRIMARY KEY("profile_id","media_type","alias")
);
--> statement-breakpoint
CREATE TABLE "progress_title_dismissal" (
	"profile_id" uuid NOT NULL,
	"canonical_title_id" uuid NOT NULL,
	"dismissed" boolean NOT NULL,
	"revision" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "progress_title_dismissal_profile_id_canonical_title_id_pk" PRIMARY KEY("profile_id","canonical_title_id")
);
--> statement-breakpoint
ALTER TABLE "watch_progress" ADD COLUMN "canonical_title_id" uuid;--> statement-breakpoint
ALTER TABLE "watch_progress" ADD COLUMN "canonical_episode_key" text;--> statement-breakpoint
ALTER TABLE "watch_progress" ADD COLUMN "revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "progress_applied_operation" ADD CONSTRAINT "progress_applied_operation_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_canonical_title" ADD CONSTRAINT "progress_canonical_title_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_event" ADD CONSTRAINT "progress_event_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_sync_state" ADD CONSTRAINT "progress_sync_state_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_title_alias" ADD CONSTRAINT "progress_title_alias_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_title_alias" ADD CONSTRAINT "progress_title_alias_canonical_title_id_progress_canonical_title_id_fk" FOREIGN KEY ("canonical_title_id") REFERENCES "public"."progress_canonical_title"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_title_dismissal" ADD CONSTRAINT "progress_title_dismissal_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_title_dismissal" ADD CONSTRAINT "progress_title_dismissal_canonical_title_id_progress_canonical_title_id_fk" FOREIGN KEY ("canonical_title_id") REFERENCES "public"."progress_canonical_title"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "progress_applied_operation_revision_idx" ON "progress_applied_operation" USING btree ("profile_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "progress_event_operation_idx" ON "progress_event" USING btree ("profile_id","operation_id");--> statement-breakpoint
CREATE INDEX "progress_title_alias_canonical_idx" ON "progress_title_alias" USING btree ("profile_id","canonical_title_id");--> statement-breakpoint
INSERT INTO "progress_sync_state" ("profile_id")
SELECT "id" FROM "profile"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "progress_canonical_title" ("id", "profile_id", "media_type")
SELECT DISTINCT
  (
    substr(md5("profile_id"::text || chr(31) || "media_type" || chr(31) || "media_id"), 1, 8) || '-' ||
    substr(md5("profile_id"::text || chr(31) || "media_type" || chr(31) || "media_id"), 9, 4) || '-' ||
    substr(md5("profile_id"::text || chr(31) || "media_type" || chr(31) || "media_id"), 13, 4) || '-' ||
    substr(md5("profile_id"::text || chr(31) || "media_type" || chr(31) || "media_id"), 17, 4) || '-' ||
    substr(md5("profile_id"::text || chr(31) || "media_type" || chr(31) || "media_id"), 21, 12)
  )::uuid,
  "profile_id",
  "media_type"
FROM "watch_progress"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "progress_title_alias" ("profile_id", "media_type", "alias", "canonical_title_id")
SELECT DISTINCT
  "profile_id",
  "media_type",
  "media_id",
  (
    substr(md5("profile_id"::text || chr(31) || "media_type" || chr(31) || "media_id"), 1, 8) || '-' ||
    substr(md5("profile_id"::text || chr(31) || "media_type" || chr(31) || "media_id"), 9, 4) || '-' ||
    substr(md5("profile_id"::text || chr(31) || "media_type" || chr(31) || "media_id"), 13, 4) || '-' ||
    substr(md5("profile_id"::text || chr(31) || "media_type" || chr(31) || "media_id"), 17, 4) || '-' ||
    substr(md5("profile_id"::text || chr(31) || "media_type" || chr(31) || "media_id"), 21, 12)
  )::uuid
FROM "watch_progress"
ON CONFLICT DO NOTHING;--> statement-breakpoint
WITH ranked AS (
  SELECT
    "profile_id",
    "video_id",
    row_number() OVER (
      PARTITION BY "profile_id", "media_type", "media_id",
        CASE
          WHEN "season" IS NULL AND "episode" IS NULL AND "media_type" = 'movie' THEN 'movie'
          WHEN "season" IS NOT NULL OR "episode" IS NOT NULL THEN 's' || coalesce("season", 0) || ':e' || coalesce("episode", 0)
          ELSE 'legacy:' || "video_id"
        END
      ORDER BY "watched" DESC, "position_ms" DESC, "updated_at" DESC, "video_id" DESC
    ) AS rank
  FROM "watch_progress"
)
DELETE FROM "watch_progress" AS progress
USING ranked
WHERE progress."profile_id" = ranked."profile_id"
  AND progress."video_id" = ranked."video_id"
  AND ranked.rank > 1;--> statement-breakpoint
UPDATE "watch_progress"
SET
  "canonical_title_id" = (
    substr(md5("profile_id"::text || chr(31) || "media_type" || chr(31) || "media_id"), 1, 8) || '-' ||
    substr(md5("profile_id"::text || chr(31) || "media_type" || chr(31) || "media_id"), 9, 4) || '-' ||
    substr(md5("profile_id"::text || chr(31) || "media_type" || chr(31) || "media_id"), 13, 4) || '-' ||
    substr(md5("profile_id"::text || chr(31) || "media_type" || chr(31) || "media_id"), 17, 4) || '-' ||
    substr(md5("profile_id"::text || chr(31) || "media_type" || chr(31) || "media_id"), 21, 12)
  )::uuid,
  "canonical_episode_key" = CASE
    WHEN "season" IS NULL AND "episode" IS NULL AND "media_type" = 'movie' THEN 'movie'
    WHEN "season" IS NOT NULL OR "episode" IS NOT NULL THEN 's' || coalesce("season", 0) || ':e' || coalesce("episode", 0)
    ELSE 'legacy:' || "video_id"
  END;--> statement-breakpoint
INSERT INTO "progress_title_dismissal" ("profile_id", "canonical_title_id", "dismissed", "revision")
SELECT "profile_id", "canonical_title_id", bool_or("dismissed"), 0
FROM "watch_progress"
WHERE "canonical_title_id" IS NOT NULL
GROUP BY "profile_id", "canonical_title_id"
HAVING bool_or("dismissed")
ON CONFLICT DO NOTHING;--> statement-breakpoint
CREATE UNIQUE INDEX "watch_progress_canonical_episode_idx" ON "watch_progress" USING btree ("profile_id","canonical_title_id","canonical_episode_key") WHERE "watch_progress"."canonical_title_id" is not null and "watch_progress"."canonical_episode_key" is not null;
