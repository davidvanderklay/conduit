import { describe, expect, it } from "vitest"
import { readLastProfileId, rememberLastProfileId } from "./profile-preference"

describe("profile preference", () => {
  it("round-trips the last selected profile", () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }

    expect(readLastProfileId(storage)).toBeUndefined()

    rememberLastProfileId("profile-two", storage)

    expect(readLastProfileId(storage)).toBe("profile-two")
  })

  it("does not break profile selection when storage is unavailable", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
    }

    expect(readLastProfileId(storage)).toBeUndefined()
    expect(() => rememberLastProfileId("profile-one", storage)).not.toThrow()
  })
})
