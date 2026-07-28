import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { DESKTOP_ORIGINS, type Config } from "./config.js"
import type { Database } from "./db/index.js"
import * as schema from "./db/schema.js"

export function createAuth(db: Database, config: Config) {
  return betterAuth({
    baseURL: config.authUrl,
    secret: config.authSecret,
    trustedOrigins: [config.webOrigin, ...DESKTOP_ORIGINS],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
