import { describe, expect, it } from "vitest"
import { hashAdminRecoveryToken } from "./admin-recovery.js"

describe("admin recovery tokens", () => {
  it("hashes tokens deterministically without storing the original value", () => {
    const token = "example-one-time-token"
    const hash = hashAdminRecoveryToken(token, "test-secret")

    expect(hash).toHaveLength(64)
    expect(hash).not.toContain(token)
    expect(hashAdminRecoveryToken(token, "test-secret")).toBe(hash)
    expect(hashAdminRecoveryToken(token, "different-secret")).not.toBe(hash)
  })
})
