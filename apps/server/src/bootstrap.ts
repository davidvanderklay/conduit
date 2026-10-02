import { randomBytes, timingSafeEqual } from "node:crypto"
import { hashPassword } from "better-auth/crypto"
import type { Config } from "./config.js"
import type { Database } from "./db/index.js"
import { accounts, users } from "./db/schema.js"

export function canCreateFirstAccount(config: Config, userCount: number): boolean {
  return userCount === 0 && config.bootstrapMode !== "manual"
}

export function hasValidBootstrapToken(config: Config, token: string | undefined): boolean {
  if (config.bootstrapMode !== "setup-token") return true
  if (!config.bootstrapToken || !token) return false
  const expected = Buffer.from(config.bootstrapToken)
  const provided = Buffer.from(token)
  return expected.length === provided.length && timingSafeEqual(expected, provided)
}

export async function createOwnerAccount(
  db: Database,
  email: string,
  password: string,
): Promise<{ id: string; email: string }> {
  const normalizedEmail = normalizeEmail(email)
  validatePassword(password)
  const passwordHash = await hashPassword(password)

  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: users.id }).from(users).limit(1)
    if (existing.length > 0) {
      throw new Error("The Conduit owner already exists; create-owner only works on an empty database")
    }

    const userId = randomBytes(24).toString("base64url")
    await tx.insert(users).values({
      id: userId,
      name: `Account ${userId.slice(0, 8)}`,
      email: normalizedEmail,
      role: "owner",
    })
    await tx.insert(accounts).values({
      id: randomBytes(24).toString("base64url"),
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
    })

    return { id: userId, email: normalizedEmail }
  })
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(normalized)) {
    throw new Error("Account email must be a valid email address")
  }
  return normalized
}

function validatePassword(password: string): void {
  if (password.length < 8 || password.length > 128) {
    throw new Error("Account password must be between 8 and 128 characters")
  }
}
