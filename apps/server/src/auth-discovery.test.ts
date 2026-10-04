import { expect, it, vi } from "vitest"
import type { Config } from "./config.js"
import type { Database } from "./db/index.js"

vi.mock("./auth.js", () => ({
  createAuth: () => ({ api: {}, handler: async () => new Response(null, { status: 404 }) }),
}))

const { buildApp } = await import("./app.js")

it("advertises the web origin separately from the API origin for TV file handoff", async () => {
  const config: Config = {
    databaseUrl: "postgresql://unused",
    authSecret: "test-secret-that-is-at-least-32-characters",
    authUrl: "https://api.example.test",
    addonEncryptionKey: Buffer.alloc(32),
    webOrigin: "https://web.example.test",
    port: 3000,
    bootstrapMode: "first-user",
    trustProxy: false,
  }
  const query = { from: () => query, limit: async () => [] }
  const db = { select: () => query } as unknown as Database
  const app = await buildApp(config, db)
  try {
    const response = await app.inject({ method: "GET", url: "/v1/auth/config" })
    expect(response.statusCode).toBe(200)
    expect(response.json().webUrl).toBe(config.webOrigin)
  } finally {
    await app.close()
  }
})
