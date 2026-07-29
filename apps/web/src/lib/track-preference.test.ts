import { describe, expect, it } from "vitest"
import type { InstalledAddon } from "./api"
import {
  configuredTrackLanguage,
  matchesTrackLanguage,
  normalizeLanguage,
} from "./track-preference"

describe("track language preferences", () => {
  it("normalizes common ISO and display language forms", () => {
    expect(normalizeLanguage("en-US")).toBe("en")
    expect(normalizeLanguage("eng")).toBe("en")
    expect(normalizeLanguage("Japanese")).toBe("ja")
  })

  it("uses an explicit preference before an add-on manifest language", () => {
    const addons = [{ manifest: { language: "en-US" } }] as unknown as InstalledAddon[]
    expect(configuredTrackLanguage("ja", addons)).toBe("ja")
    expect(configuredTrackLanguage("auto", addons)).toBe("en")
  })

  it("matches track codes and human-readable titles", () => {
    expect(matchesTrackLanguage("en", "eng", "English Audio")).toBe(true)
    expect(matchesTrackLanguage("ja", undefined, "Japanese")).toBe(true)
    expect(matchesTrackLanguage("en", "jpn", "Japanese")).toBe(false)
  })
})
