import cors from "@fastify/cors"
import sensible from "@fastify/sensible"
import Fastify from "fastify"
import { fromNodeHeaders } from "better-auth/node"
import { createAuth } from "./auth.js"
import type { Config } from "./config.js"
import type { Database } from "./db/index.js"
import { registerRoutes } from "./routes.js"

export async function buildApp(config: Config, db: Database) {
  const app = Fastify({ logger: true })
  const auth = createAuth(db, config)

  await app.register(cors, {
    origin: config.webOrigin,
    credentials: true,
  })
  await app.register(sensible)

  app.all("/api/auth/*", async (request, reply) => {
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

  await registerRoutes(app, { auth, config, db })
  return app
}
