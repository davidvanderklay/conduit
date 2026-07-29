ALTER TABLE "instance_setting" ADD COLUMN "oauth_provider" text DEFAULT 'google' NOT NULL;--> statement-breakpoint
UPDATE "instance_setting" SET "oauth_provider" = 'oidc'
WHERE "oidc_enabled" = true AND "oidc_issuer" IS NOT NULL;
