import { describe, expect, it } from "vitest"
import { decryptSecret, encryptSecret, stableSecretHash } from "./crypto.js"

describe("configured add-on URL encryption", () => {
  const key = Buffer.alloc(32, 7)

  it("round trips without exposing the plaintext", () => {
    const value = "https://addon.example/token=secret/manifest.json"
    const encrypted = encryptSecret(value, key)

    expect(encrypted).not.toContain("secret")
    expect(decryptSecret(encrypted, key)).toBe(value)
  })

  it("produces a stable lookup hash", () => {
    expect(stableSecretHash("same", key)).toBe(stableSecretHash("same", key))
    expect(stableSecretHash("same", key)).not.toBe(stableSecretHash("different", key))
    expect(stableSecretHash("same", key)).not.toBe(stableSecretHash("same", Buffer.alloc(32, 8)))
  })
})
