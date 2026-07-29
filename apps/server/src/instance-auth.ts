import { eq } from "drizzle-orm"
import type { Config } from "./config.js"
import { decryptSecret } from "./crypto.js"
import type { Database } from "./db/index.js"
import { instanceSettings } from "./db/schema.js"

export type RegistrationMode = "open" | "closed"

export interface RuntimeAuthSettings {
  registrationMode: RegistrationMode
  oidc?: {
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
    !row.oidcIssuer ||
    !row.oidcClientId ||
    !row.oidcClientSecretEncrypted
  ) {
    return { registrationMode }
  }

  return {
    registrationMode,
    oidc: {
      issuer: row.oidcIssuer,
      clientId: row.oidcClientId,
      clientSecret: decryptSecret(row.oidcClientSecretEncrypted, config.addonEncryptionKey),
      displayName: row.oidcDisplayName,
      scopes: row.oidcScopes.split(/\s+/).filter(Boolean),
      autoRegister: row.oidcAutoRegister,
    },
  }
}
