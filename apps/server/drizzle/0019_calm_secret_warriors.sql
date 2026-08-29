ALTER TABLE "account" ADD COLUMN "issuer" text;--> statement-breakpoint
UPDATE "account"
SET "issuer" = CASE
  WHEN "provider_id" = 'credential' THEN 'local:credential'
  WHEN "provider_id" = 'google' THEN 'https://accounts.google.com'
END
WHERE "provider_id" IN ('credential', 'google');--> statement-breakpoint
UPDATE "account"
SET "issuer" = (
  SELECT "oidc_issuer"
  FROM "instance_setting"
  WHERE "id" = 'default'
    AND "oauth_provider" = 'oidc'
)
WHERE "provider_id" = 'conduit-oidc';--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "account" WHERE "issuer" IS NULL) THEN
    RAISE EXCEPTION 'Cannot migrate OAuth accounts: an account has an unknown or unconfigured issuer';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "account"
    GROUP BY "issuer", "account_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot migrate OAuth accounts: duplicate issuer/account identities exist';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
DROP INDEX "account_provider_identity_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_identity_idx" ON "account" USING btree ("issuer","account_id");
