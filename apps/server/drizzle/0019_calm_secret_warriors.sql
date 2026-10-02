-- Better Auth 1.7.3+ returned to provider/account identities. Do not infer
-- historical issuers from current settings or block upgrades at this step.
-- 0020 repairs databases that already ran the original required-issuer version.
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "issuer" text;
