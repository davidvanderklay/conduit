import { describe, expect, it } from "vitest"
import {
  hashDesktopCode,
  pkceChallenge,
  secureEqual,
  validPkceVerifier,
  validateLoopbackCallback,
  validateMobileCallback,
} from "./desktop-auth.js"

describe("desktop authentication handoff", () => {
  it("accepts only an exact random-port loopback callback", () => {
    expect(validateLoopbackCallback("http://127.0.0.1:49152/oauth/callback")).toBe(
      "http://127.0.0.1:49152/oauth/callback",
    )
    expect(() => validateLoopbackCallback("http://localhost:49152/oauth/callback")).toThrow()
    expect(() => validateLoopbackCallback("https://127.0.0.1:49152/oauth/callback")).toThrow()
    expect(() => validateLoopbackCallback("http://127.0.0.1:49152/other")).toThrow()
    expect(() =>
      validateLoopbackCallback("http://127.0.0.1:49152/oauth/callback?redirect=evil"),
    ).toThrow()
  })

  it("derives and validates an RFC 7636-style verifier challenge", () => {
    const verifier = "a".repeat(64)
    expect(validPkceVerifier(verifier)).toBe(true)
    expect(validPkceVerifier("short")).toBe(false)
    expect(pkceChallenge(verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(secureEqual(pkceChallenge(verifier), pkceChallenge(verifier))).toBe(true)
    expect(secureEqual(pkceChallenge(verifier), pkceChallenge("b".repeat(64)))).toBe(false)
  })

  it("binds handoff codes to the server secret", () => {
    expect(hashDesktopCode("code", "secret-a")).toBe(hashDesktopCode("code", "secret-a"))
    expect(hashDesktopCode("code", "secret-a")).not.toBe(hashDesktopCode("code", "secret-b"))
  })
})

describe("mobile authentication handoff", () => {
  it("accepts only the exact Conduit callback", () => {
    expect(validateMobileCallback("conduit://oauth/callback")).toBe("conduit://oauth/callback")
    expect(() => validateMobileCallback("conduit://oauth/other")).toThrow()
    expect(() => validateMobileCallback("conduit://oauth/callback?token=bad")).toThrow()
    expect(() => validateMobileCallback("https://example.com/oauth/callback")).toThrow()
  })
})
