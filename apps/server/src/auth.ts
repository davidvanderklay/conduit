import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { genericOAuth } from "better-auth/plugins"
import { DESKTOP_ORIGINS, type Config } from "./config.js"
import type { Database } from "./db/index.js"
import type { RuntimeAuthSettings } from "./instance-auth.js"
import * as schema from "./db/schema.js"

export function createAuth(db: Database, config: Config, settings: RuntimeAuthSettings) {
  const plugins = settings.oidc
    ? [
        genericOAuth({
          config: [
            {
              providerId: "conduit-oidc",
              discoveryUrl: settings.oidc.issuer,
              clientId: settings.oidc.clientId,
              clientSecret: settings.oidc.clientSecret,
              scopes: settings.oidc.scopes,
              pkce: true,
              disableImplicitSignUp: !settings.oidc.autoRegister,
            },
          ],
        }),
      ]
    : []
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
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "member",
          input: false,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const existing = await db.select({ id: schema.users.id }).from(schema.users).limit(1)
            return {
              data: {
                ...user,
                // Better Auth requires a name, but Conduit deliberately does not collect one.
                name: `Account ${user.id.slice(0, 8)}`,
                role: existing.length > 0 ? "member" : "owner",
              },
            }
          },
        },
      },
    },
    plugins,
  })
}

export type Auth = ReturnType<typeof createAuth>
