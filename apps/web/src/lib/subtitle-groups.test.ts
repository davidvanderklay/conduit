import { describe, expect, it } from "vitest"
import { groupSubtitles, normalizeSubtitleLanguage } from "./subtitle-groups"

describe("subtitle language groups", () => {
  it("normalizes codes, locale tags, names, and aliases", () => {
    expect(["en", "eng", "en-US", "English"].map(normalizeSubtitleLanguage)).toEqual([
      "en", "en", "en", "en",
    ])
  })

  it("keeps variants and puts the preferred language first and unknown last", () => {
    const tracks = [
      { id: 1, language: undefined },
      { id: 2, language: "es" },
      { id: 3, language: "eng" },
      { id: 4, language: "English" },
    ]
    const groups = groupSubtitles(tracks, (track) => track.language, "en-US")
    expect(groups.map((group) => [group.code, group.tracks.map((track) => track.id)])).toEqual([
      ["en", [3, 4]],
      ["es", [2]],
      ["und", [1]],
    ])
  })
})
