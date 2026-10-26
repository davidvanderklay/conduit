import type { Auth } from "../auth.js"
import type { Config } from "../config.js"
import type { Database } from "../db/index.js"
import type { IntegrationSync } from "../integrations/service.js"
import type { RuntimeAuthSettings } from "../instance-auth.js"

export interface RouteContext {
  auth: Auth
  authSettings: RuntimeAuthSettings
  config: Config
  db: Database
  /** Absent in route tests that build a partial context. */
  integrations?: IntegrationSync
}

export interface SessionUser {
  id: string
  email: string
  sessionId?: string
  sessionCreatedAt: Date
}
