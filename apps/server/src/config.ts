import { createHash } from "node:crypto"

export type BootstrapMode = "setup-token" | "first-user" | "manual"

export interface Config {
  databaseUrl: string
  authSecret: string
  authUrl: string
  addonEncryptionKey: Buffer
  webOrigin: string
  port: number
  bootstrapMode: BootstrapMode
  bootstrapToken?: string
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
  const bootstrapMode = parseBootstrapMode(env.CONDUIT_BOOTSTRAP_MODE)
  const bootstrapToken = env.CONDUIT_BOOTSTRAP_TOKEN?.trim()

  if (bootstrapMode === "setup-token" && !bootstrapToken) {
    throw new Error("CONDUIT_BOOTSTRAP_TOKEN is required when CONDUIT_BOOTSTRAP_MODE is setup-token")
  }

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
    bootstrapMode,
    bootstrapToken,
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

function parseBootstrapMode(value: string | undefined): BootstrapMode {
  const mode = value ?? "first-user"
  switch (mode) {
    case "setup-token":
    case "first-user":
    case "manual":
      return mode
    default:
      throw new Error("CONDUIT_BOOTSTRAP_MODE must be setup-token, first-user, or manual")
  }
}
