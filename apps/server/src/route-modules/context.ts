import type { Auth } from "../auth.js"
import type { Config } from "../config.js"
import type { Database } from "../db/index.js"
import type { RuntimeAuthSettings } from "../instance-auth.js"

export interface RouteContext {
  auth: Auth
  authSettings: RuntimeAuthSettings
  config: Config
  db: Database
}

export interface SessionUser {
  id: string
  email: string
  sessionId?: string
  sessionCreatedAt: Date
}
