import { describe, expect, it } from "vitest"
import { defaultPreferences, readPreferences } from "./preferences"

function storage(value?: string): Storage {
  return {
    getItem: () => value ?? null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  }
}

describe("device preferences", () => {
  it("uses safe defaults for missing or invalid data", () => {
    expect(readPreferences(storage())).toEqual(defaultPreferences)
    expect(readPreferences(storage("nope"))).toEqual(defaultPreferences)
  })

  it("validates numeric ranges", () => {
    const value = readPreferences(storage(JSON.stringify({ volume: 900, subtitleSize: 2 })))
    expect(value.volume).toBe(100)
    expect(value.subtitleSize).toBe(75)
  })
})
