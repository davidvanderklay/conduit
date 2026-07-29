import cors from "@fastify/cors"
import sensible from "@fastify/sensible"
import Fastify from "fastify"
import { fromNodeHeaders } from "better-auth/node"
import { createAuth } from "./auth.js"
import { DESKTOP_ORIGINS, type Config } from "./config.js"
import type { Database } from "./db/index.js"
import { loadRuntimeAuthSettings } from "./instance-auth.js"
import { registerRoutes } from "./routes.js"

export async function buildApp(config: Config, db: Database) {
  const app = Fastify({ logger: true })
  const authSettings = await loadRuntimeAuthSettings(db, config)
  const auth = createAuth(db, config, authSettings)

  await app.register(cors, {
    origin: [config.webOrigin, ...DESKTOP_ORIGINS],
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 600,
  })
  await app.register(sensible)

  app.all("/api/auth/*", async (request, reply) => {
    if (
      request.method === "POST" &&
      request.url.startsWith("/api/auth/sign-up/") &&
      authSettings.registrationMode !== "open" &&
      db.select
    ) {
      const { users } = await import("./db/schema.js")
      const existing = await db.select({ id: users.id }).from(users).limit(1)
      if (existing.length > 0) {
        return reply.code(403).send({ message: "Local account registration is disabled" })
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
