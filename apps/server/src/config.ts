import { createHash } from "node:crypto"

export interface Config {
  databaseUrl: string
  authSecret: string
  authUrl: string
  addonEncryptionKey: Buffer
  webOrigin: string
  port: number
}

export const DESKTOP_ORIGINS = [
  "conduit://localhost",
]

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = required(env, "DATABASE_URL")
  const authSecret = required(env, "BETTER_AUTH_SECRET")
  const authUrl = required(env, "BETTER_AUTH_URL")
  const webOrigin = env.WEB_ORIGIN ?? "http://localhost:5173"
  const port = Number.parseInt(env.PORT ?? "3000", 10)
  const encryptionValue = required(env, "ADDON_ENCRYPTION_KEY")
  const addonEncryptionKey = parseEncryptionKey(encryptionValue)

  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port")
  }

  return {
    databaseUrl,
    authSecret,
    authUrl,
    addonEncryptionKey,
    webOrigin,
    port,
  }
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim()
  if (!value) {
    throw new Error(`${key} is required`)
  }
  return value
}

function parseEncryptionKey(value: string): Buffer {
  if (/^[a-fA-F0-9]{64}$/.test(value)) {
    return Buffer.from(value, "hex")
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("ADDON_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters")
  }

  return createHash("sha256").update(value).digest()
}
