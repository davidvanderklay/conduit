import { eq } from "drizzle-orm"
import type { Config } from "./config.js"
import { decryptSecret } from "./crypto.js"
import type { Database } from "./db/index.js"
import { instanceSettings } from "./db/schema.js"

export type RegistrationMode = "open" | "closed"

export interface RuntimeAuthSettings {
  registrationMode: RegistrationMode
  oidc?: {
    provider: "google" | "oidc"
    issuer: string
    clientId: string
    clientSecret: string
    displayName: string
    scopes: string[]
    autoRegister: boolean
  }
}

export const DEFAULT_AUTH_SETTINGS: RuntimeAuthSettings = { registrationMode: "closed" }

export async function loadRuntimeAuthSettings(
  db: Database,
  config: Config,
): Promise<RuntimeAuthSettings> {
  // Some isolated app tests intentionally use a database stub.
  if (!db.query?.instanceSettings) return DEFAULT_AUTH_SETTINGS
  const row = await db.query.instanceSettings.findFirst({
    where: eq(instanceSettings.id, "default"),
  })
  if (!row) return DEFAULT_AUTH_SETTINGS

  const registrationMode = row.registrationMode === "open" ? "open" : "closed"
  if (
    !row.oidcEnabled ||
    !row.oidcClientId ||
    !row.oidcClientSecretEncrypted ||
    (row.oauthProvider === "oidc" && !row.oidcIssuer)
  ) {
    return { registrationMode }
  }

  return {
    registrationMode,
    oidc: {
      provider: row.oauthProvider === "oidc" ? "oidc" : "google",
      issuer: row.oidcIssuer ?? "",
      clientId: row.oidcClientId,
      clientSecret: decryptSecret(row.oidcClientSecretEncrypted, config.addonEncryptionKey),
      displayName:
        row.oauthProvider === "oidc" ? row.oidcDisplayName : "Continue with Google",
      scopes:
        row.oauthProvider === "oidc"
          ? row.oidcScopes.split(/\s+/).filter(Boolean)
          : ["openid", "email"],
      autoRegister: row.oidcAutoRegister,
    },
  }
}
