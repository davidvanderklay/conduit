import { describe, expect, it } from "vitest"
import { parseTrustedHttpUrl } from "./url-security.js"

describe("trusted HTTP URLs", () => {
  it("allows HTTPS and loopback HTTP only", () => {
    expect(parseTrustedHttpUrl("https://example.com/addon", "URL").protocol).toBe("https:")
    expect(parseTrustedHttpUrl("http://127.0.0.1:3000", "URL").hostname).toBe("127.0.0.1")
    expect(() => parseTrustedHttpUrl("http://example.com", "URL")).toThrow(/HTTPS/)
  })

  it("rejects embedded URL credentials", () => {
    expect(() => parseTrustedHttpUrl("https://user:password@example.com", "URL")).toThrow(
      "must not contain URL credentials",
    )
  })
})
