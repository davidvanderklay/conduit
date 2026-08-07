import cors from "@fastify/cors"
import sensible from "@fastify/sensible"
import Fastify from "fastify"
import { fromNodeHeaders } from "better-auth/node"
import { createAuth } from "./auth.js"
import { DESKTOP_ORIGINS, type Config } from "./config.js"
import { canCreateFirstAccount, hasValidBootstrapToken } from "./bootstrap.js"
import type { Database } from "./db/index.js"
import { users } from "./db/schema.js"
import { loadRuntimeAuthSettings } from "./instance-auth.js"
import { registerRoutes } from "./routes.js"

export async function buildApp(config: Config, db: Database) {
  const app = Fastify({ logger: true })
  const authSettings = await loadRuntimeAuthSettings(db, config)
  const existingUsers = db.select ? await db.select({ id: users.id }).from(users).limit(1) : [{ id: "unknown" }]
  const auth = createAuth(db, config, authSettings, { hasExistingUsers: existingUsers.length > 0 })

  await app.register(cors, {
    origin: [config.webOrigin, ...DESKTOP_ORIGINS],
    credentials: true,
    allowedHeaders: ["content-type", "authorization", "x-conduit-bootstrap-token"],
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 600,
  })
  await app.register(sensible)

  app.all("/api/auth/*", async (request, reply) => {
    if (request.method === "POST" && request.url.startsWith("/api/auth/sign-up/") && db.select) {
      const existing = await db.select({ id: users.id }).from(users).limit(1)
      if (existing.length === 0 && config.bootstrapMode === "manual") {
        return reply.code(403).send({ message: "Create the first owner from the Conduit server CLI" })
      }
      if (!canCreateFirstAccount(config, existing.length) && authSettings.registrationMode !== "open") {
        return reply.code(403).send({ message: "Local account registration is disabled" })
      }
      if (
        existing.length === 0 &&
        config.bootstrapMode === "setup-token" &&
        !hasValidBootstrapToken(
          config,
          Array.isArray(request.headers["x-conduit-bootstrap-token"])
            ? request.headers["x-conduit-bootstrap-token"][0]
            : request.headers["x-conduit-bootstrap-token"],
        )
      ) {
        return reply.code(403).send({ message: "A valid Conduit setup token is required to create the first owner" })
      }
    }
    const headers = fromNodeHeaders(request.headers)
    const hasBody = !["GET", "HEAD"].includes(request.method)
    const body = hasBody
      ? Buffer.isBuffer(request.body)
        ? request.body.toString("utf8")
        : typeof request.body === "string"
          ? request.body
          : JSON.stringify(request.body)
      : undefined
    const response = await auth.handler(
      new Request(new URL(request.url, config.authUrl), {
        method: request.method,
        headers,
        body,
      }),
    )

    reply.code(response.status)
    response.headers.forEach((value, name) => {
      if (name !== "set-cookie") reply.header(name, value)
    })
    const cookies = response.headers.getSetCookie()
    if (cookies.length > 0) reply.header("set-cookie", cookies)
    return reply.send(Buffer.from(await response.arrayBuffer()))
  })

  await registerRoutes(app, { auth, authSettings, config, db })
  return app
}
