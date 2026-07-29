import { createHmac, randomBytes } from "node:crypto"
import { eq, lt } from "drizzle-orm"
import type { Config } from "./config.js"
import type { Database } from "./db/index.js"
import { adminRecoveryTokens, users } from "./db/schema.js"

export const ADMIN_RECOVERY_TTL_MINUTES = 10

export function hashAdminRecoveryToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex")
}

export async function createAdminRecoveryLink(
  db: Database,
  config: Config,
  email: string,
): Promise<{ url: string; expiresAt: Date } | undefined> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1)
  if (!user) return

  const token = randomBytes(32).toString("base64url")
  const expiresAt = new Date(Date.now() + ADMIN_RECOVERY_TTL_MINUTES * 60_000)
  await db.delete(adminRecoveryTokens).where(lt(adminRecoveryTokens.expiresAt, new Date()))
  await db.insert(adminRecoveryTokens).values({
    userId: user.id,
    tokenHash: hashAdminRecoveryToken(token, config.authSecret),
    expiresAt,
  })
  const url = new URL("/recover/admin", config.webOrigin)
  url.searchParams.set("token", token)
  return { url: url.toString(), expiresAt }
}
