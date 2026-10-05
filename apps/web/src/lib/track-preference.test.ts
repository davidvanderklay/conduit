import { describe, expect, it } from "vitest"
import { configuredTrackLanguage, matchesTrackLanguage } from "./track-preference"

describe("track language preferences", () => {
  it("uses the device language for System default", () => {
    expect(configuredTrackLanguage("auto", "en-US")).toBe("en")
    expect(configuredTrackLanguage("auto", "de-DE")).toBe("de")
    expect(configuredTrackLanguage("", "fr-CA")).toBe("fr")
  })

  it("uses an explicit preference before the device language", () => {
    expect(configuredTrackLanguage("ja", "en-US")).toBe("ja")
  })

  it("matches track codes and human-readable titles", () => {
    expect(matchesTrackLanguage("en", "eng", "English Audio")).toBe(true)
    expect(matchesTrackLanguage("ja", undefined, "Japanese")).toBe(true)
    expect(matchesTrackLanguage("en", "jpn", "Japanese")).toBe(false)
  })

  it("matches languages added to the picker through their aliases", () => {
    expect(matchesTrackLanguage("sv", "swe")).toBe(true)
    expect(matchesTrackLanguage("el", "gre")).toBe(true)
    expect(matchesTrackLanguage("pt", "pt-BR")).toBe(true)
    expect(matchesTrackLanguage("no", "eng", "No signs")).toBe(false)
  })
})
