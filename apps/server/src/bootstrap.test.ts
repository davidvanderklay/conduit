import { describe, expect, it } from "vitest"
import { accounts, users } from "./db/schema.js"
import type { Config } from "./config.js"
import { canCreateFirstAccount, createOwnerAccount, hasValidBootstrapToken } from "./bootstrap.js"
import type { Database } from "./db/index.js"

const baseConfig: Config = {
  databaseUrl: "postgresql://unused",
  authSecret: "test-secret-that-is-at-least-32-characters",
  authUrl: "http://localhost:3000",
  addonEncryptionKey: Buffer.alloc(32),
  webOrigin: "http://localhost:5173",
  port: 3000,
  bootstrapMode: "first-user",
  trustProxy: false,
}

describe("first-owner bootstrap", () => {
  it("supports the three bootstrap modes", () => {
    expect(canCreateFirstAccount({ ...baseConfig, bootstrapMode: "first-user" }, 0)).toBe(true)
    expect(canCreateFirstAccount({ ...baseConfig, bootstrapMode: "setup-token" }, 0)).toBe(true)
    expect(canCreateFirstAccount({ ...baseConfig, bootstrapMode: "manual" }, 0)).toBe(false)
    expect(canCreateFirstAccount(baseConfig, 1)).toBe(false)
  })

  it("compares setup tokens without accepting a missing or wrong token", () => {
    const config = { ...baseConfig, bootstrapMode: "setup-token" as const, bootstrapToken: "private-token" }
    expect(hasValidBootstrapToken(config, "private-token")).toBe(true)
    expect(hasValidBootstrapToken(config, "wrong-token")).toBe(false)
    expect(hasValidBootstrapToken(config, undefined)).toBe(false)
  })

  it("creates one credential owner and refuses a second owner", async () => {
    const rows: { table: unknown; value: Record<string, unknown> }[] = []
    const database = {
      transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          select: () => ({
            from: (table: unknown) => ({
              limit: async () => (table === users && rows.some((row) => row.table === users) ? [{ id: "owner" }] : []),
            }),
          }),
          insert: (table: unknown) => ({
            values: async (value: Record<string, unknown>) => {
              rows.push({ table, value })
            },
          }),
        }),
    } as unknown as Database

    const owner = await createOwnerAccount(database, " OWNER@Example.com ", "correct horse battery")
    expect(owner.email).toBe("owner@example.com")
    expect(rows.find((row) => row.table === users)?.value.role).toBe("owner")
    expect(rows.find((row) => row.table === accounts)?.value.providerId).toBe("credential")
    await expect(createOwnerAccount(database, "second@example.com", "another password")).rejects.toThrow(
      "owner already exists",
    )
  })
})
