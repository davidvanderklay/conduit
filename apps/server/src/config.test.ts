import { describe, expect, it } from "vitest"
import { loadConfig } from "./config.js"

const valid = {
  DATABASE_URL: "postgresql://localhost/conduit",
  BETTER_AUTH_SECRET: "a-secure-development-secret",
  BETTER_AUTH_URL: "http://localhost:3000",
  ADDON_ENCRYPTION_KEY: "11".repeat(32),
}

describe("configuration", () => {
  it("accepts a hexadecimal encryption key", () => {
    expect(loadConfig(valid).addonEncryptionKey).toHaveLength(32)
  })

  it("requires database configuration", () => {
    expect(() => loadConfig({ ...valid, DATABASE_URL: "" })).toThrow("DATABASE_URL is required")
  })
})
