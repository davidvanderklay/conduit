import { afterEach, expect, it, vi } from "vitest"
import Fastify from "fastify"
import sensible from "@fastify/sensible"
import type { RouteContext } from "./context.js"
const access = vi.hoisted(() => ({ signedIn: true, owner: false }))
vi.mock("./helpers.js", () => ({
  requireUser: async (_request: unknown, reply: { unauthorized(): void }) => {
    if (!access.signedIn) {
      reply.unauthorized()
      return undefined
    }
    return { id: "user" }
  },
  requireOwner: async (_request: unknown, reply: { forbidden(): void }) => {
    if (!access.owner) {
      reply.forbidden()
      return undefined
    }
    return { id: "owner" }
  },
}))
import { registerUpdateRoutes } from "./update-routes.js"
afterEach(() => vi.unstubAllEnvs())
it("version status requires a session and administrative checks require owner access", async () => {
  vi.stubEnv("CONDUIT_UPDATE_CHECKS", "false")
  const app = Fastify()
  await app.register(sensible)
  // Route authorization is mocked; these handlers never access the database directly.
  registerUpdateRoutes(app, {} as RouteContext)
  try {
    access.signedIn = false
    expect((await app.inject("/v1/system/info")).statusCode).toBe(401)
    access.signedIn = true
    const info = await app.inject("/v1/system/info")
    expect(info.statusCode).toBe(200)
    expect(info.json().isOwner).toBe(false)
    for (const [url, method] of [
      ["/v1/admin/updates", "GET"],
      ["/v1/admin/updates/check", "POST"],
    ] as const) {
      expect((await app.inject({ url, method })).statusCode).toBe(403)
    }
    access.owner = true
    const owner = await app.inject({ url: "/v1/admin/updates/check", method: "POST" })
    expect(owner.statusCode).toBe(200)
    expect(owner.json().isOwner).toBe(true)
  } finally {
    await app.close()
    access.owner = false
  }
})
