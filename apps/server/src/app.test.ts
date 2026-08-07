import { afterEach, describe, expect, it } from "vitest"
import type { Config } from "./config.js"
import type { Database } from "./db/index.js"
import { buildApp } from "./app.js"

const config: Config = {
  databaseUrl: "postgresql://unused",
  authSecret: "test-secret-that-is-at-least-32-characters",
  authUrl: "http://localhost:3000",
  addonEncryptionKey: Buffer.alloc(32),
  webOrigin: "http://localhost:5173",
  port: 3000,
  bootstrapMode: "first-user",
}

describe("CORS", () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = []

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()))
  })

  it("allows browser add-on deletion preflights", async () => {
    const app = await buildApp(config, {} as Database)
    apps.push(app)

    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/profiles/00000000-0000-4000-8000-000000000000/addons/00000000-0000-4000-8000-000000000000",
      headers: {
        origin: config.webOrigin,
        "access-control-request-method": "DELETE",
        "access-control-request-headers": "content-type",
      },
    })

    expect(response.statusCode).toBe(204)
    expect(response.headers["access-control-allow-origin"]).toBe(config.webOrigin)
    expect(response.headers["access-control-allow-methods"]).toContain("DELETE")
  })

  it("prevents authenticated API responses from being stored", async () => {
    const app = await buildApp(config, {} as Database)
    apps.push(app)

    const response = await app.inject({
      method: "GET",
      url: "/v1/bootstrap",
    })

    expect(response.headers["cache-control"]).toBe("private, no-store")
  })

  it("protects setup-token and manual first-owner registration", async () => {
    const database = {
      select: () => ({
        from: () => ({ limit: async () => [] }),
      }),
    } as unknown as Database
    const setupApp = await buildApp(
      { ...config, bootstrapMode: "setup-token", bootstrapToken: "private-token" },
      database,
    )
    apps.push(setupApp)
    const setupResponse = await setupApp.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: { email: "owner@example.com", password: "correct horse battery", name: "Conduit account" },
    })
    expect(setupResponse.statusCode).toBe(403)
    expect(setupResponse.json()).toEqual({ message: "A valid Conduit setup token is required to create the first owner" })

    const manualApp = await buildApp({ ...config, bootstrapMode: "manual" }, database)
    apps.push(manualApp)
    const manualResponse = await manualApp.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: { email: "owner@example.com", password: "correct horse battery", name: "Conduit account" },
    })
    expect(manualResponse.statusCode).toBe(403)
    expect(manualResponse.json()).toEqual({ message: "Create the first owner from the Conduit server CLI" })
  })
})
