DROP INDEX IF EXISTS "account_issuer_identity_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "account_provider_identity_idx" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
ALTER TABLE "account" DROP COLUMN IF EXISTS "issuer";
