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

  it("defaults to the compatible first-user bootstrap mode", () => {
    expect(loadConfig(valid).bootstrapMode).toBe("first-user")
  })

  it("requires a token for setup-token mode", () => {
    expect(() => loadConfig({ ...valid, CONDUIT_BOOTSTRAP_MODE: "setup-token" })).toThrow(
      "CONDUIT_BOOTSTRAP_TOKEN is required",
    )
    expect(
      loadConfig({
        ...valid,
        CONDUIT_BOOTSTRAP_MODE: "setup-token",
        CONDUIT_BOOTSTRAP_TOKEN: "private-token",
      }).bootstrapToken,
    ).toBe("private-token")
  })

  it("rejects unknown bootstrap modes", () => {
    expect(() => loadConfig({ ...valid, CONDUIT_BOOTSTRAP_MODE: "unsafe" })).toThrow(
      "CONDUIT_BOOTSTRAP_MODE must be setup-token, first-user, or manual",
    )
  })
})
