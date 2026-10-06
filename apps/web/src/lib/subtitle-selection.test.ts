import { afterEach, describe, expect, it, vi } from "vitest"
import {
  preferredSubtitle,
  subtitleLookupResults,
  type SubtitleCandidate,
} from "./subtitle-selection"

const embedded = (track: string, language: string): SubtitleCandidate<string> => ({
  track,
  language,
  embedded: true,
})
const addon = (track: string, language: string): SubtitleCandidate<string> => ({
  track,
  language,
  embedded: false,
})
function select(
  candidates: SubtitleCandidate<string>[],
  addonsReady = true,
  secondary: string | null = "es",
) {
  return preferredSubtitle({
    candidates,
    primary: "en",
    secondary,
    embeddedReady: true,
    addonsReady,
  })
}

describe("automatic subtitle priority", () => {
  it("prefers primary embedded tracks even while add-ons are pending", () => {
    expect(
      select([addon("en-addon", "eng"), embedded("es", "es"), embedded("en", "en-US")], false),
    ).toBe("en")
  })
  it("waits for add-ons before falling back to an embedded secondary", () => {
    expect(select([embedded("es", "es")], false)).toBeUndefined()
    expect(select([embedded("es", "es"), addon("en", "eng")])).toBe("en")
  })
  it("prefers embedded tracks within the secondary language", () => {
    expect(select([addon("es-addon", "spa"), embedded("es", "es-MX")])).toBe("es")
  })
  it("uses a secondary add-on when neither language is embedded", () => {
    expect(select([addon("es", "Spanish")])).toBe("es")
  })
  it("turns subtitles off when neither language is available or fallback is disabled", () => {
    expect(select([embedded("ja", "ja")])).toBeNull()
    expect(select([embedded("es", "es")], true, null)).toBeNull()
  })
  it("waits for embedded metadata before choosing an external primary", () => {
    expect(
      preferredSubtitle({
        candidates: [addon("en", "en")],
        primary: "en",
        secondary: "es",
        embeddedReady: false,
        addonsReady: true,
      }),
    ).toBeUndefined()
  })
  it("resolves System default and deduplicates language aliases", () => {
    vi.stubGlobal("navigator", { language: "es-MX" })
    expect(
      preferredSubtitle({
        candidates: [embedded("es", "spa")],
        primary: "auto",
        secondary: "Spanish",
        embeddedReady: true,
        addonsReady: false,
      }),
    ).toBe("es")
    vi.unstubAllGlobals()
  })
  it("matches titles when a language tag is missing", () => {
    expect(select([{ track: "en", title: "English SDH", embedded: true }])).toBe("en")
  })
})

describe("bounded subtitle discovery", () => {
  afterEach(() => vi.useRealTimers())
  it("retains successful results when another provider times out or fails", async () => {
    vi.useFakeTimers()
    const result = subtitleLookupResults(
      [
        Promise.resolve("primary"),
        Promise.reject(new Error("offline")),
        new Promise<string>(() => undefined),
      ],
      100,
    )
    await vi.advanceTimersByTimeAsync(100)
    expect(await result).toEqual([
      { status: "fulfilled", value: "primary" },
      { status: "rejected", reason: expect.any(Error) },
      { status: "rejected", reason: expect.any(Error) },
    ])
  })
})
