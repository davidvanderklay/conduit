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
  it("defaults audio and subtitles to English", () => {
    expect(defaultPreferences.audioLanguage).toBe("en")
    expect(defaultPreferences.subtitleLanguage).toBe("en")
    expect(defaultPreferences.autoSelectSavedStreams).toBe(true)
  })

  it("uses safe defaults for missing or invalid data", () => {
    expect(readPreferences(storage())).toEqual(defaultPreferences)
    expect(readPreferences(storage("nope"))).toEqual(defaultPreferences)
  })

  it("validates numeric ranges", () => {
    const value = readPreferences(storage(JSON.stringify({
      volume: 900,
      subtitleSize: 2,
      subtitlePosition: 900,
      readAheadSeconds: 900,
    })))
    expect(value.volume).toBe(100)
    expect(value.subtitleSize).toBe(75)
    expect(value.subtitlePosition).toBe(100)
    expect(value.readAheadSeconds).toBe(120)
  })

  it("migrates older stored preferences with new desktop defaults", () => {
    const value = readPreferences(storage(JSON.stringify({ volume: 42, autoplay: false })))
    expect(value).toMatchObject({
      volume: 42,
      autoplay: false,
      autoSelectSavedStreams: true,
      amoledBlack: false,
      subtitleOutline: true,
      rememberLastProfile: true,
      debugLogging: false,
    })
  })

  it("preserves an explicit saved-stream selection preference", () => {
    expect(readPreferences(storage(JSON.stringify({ autoSelectSavedStreams: false })))).toMatchObject({
      autoSelectSavedStreams: false,
    })
  })
})
