import { describe, expect, it } from "vitest"
import { defaultPreferences } from "./preferences"
import { preferredSubtitle } from "./subtitle-selection"
import {
  SUBTITLES_OFF,
  audioChoice,
  formatSubtitleDelay,
  readTitlePlayback,
  rememberTitlePlayback,
  stepSubtitleDelay,
  subtitleChoice,
  titleLanguagePreferences,
} from "./title-playback"

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
    clear: () => values.clear(),
    key: () => null,
    get length() {
      return values.size
    },
  }
}

describe("title playback choices", () => {
  it("remembers picks per profile and title", () => {
    const storage = memoryStorage()
    rememberTitlePlayback("profile", "tt1", audioChoice("jpn", "Japanese 5.1"), storage)
    rememberTitlePlayback("profile", "tt1", subtitleChoice({ label: "English (SDH)" }), storage)

    expect(readTitlePlayback("profile", "tt1", storage)).toEqual({
      audioLanguage: "ja",
      subtitleLanguage: "en",
    })
    expect(readTitlePlayback("other", "tt1", storage)).toEqual({})
  })

  it("keeps the previous choice when a pick has no recognizable language", () => {
    const storage = memoryStorage()
    rememberTitlePlayback("profile", "tt1", subtitleChoice("off"), storage)
    rememberTitlePlayback(
      "profile",
      "tt1",
      subtitleChoice({ language: "und", label: "Signs" }),
      storage,
    )

    expect(readTitlePlayback("profile", "tt1", storage).subtitleLanguage).toBe(SUBTITLES_OFF)
  })

  it("applies remembered languages ahead of global preferences", () => {
    const preferences = { ...defaultPreferences, secondarySubtitleLanguage: "fr" }

    expect(titleLanguagePreferences(preferences, {})).toEqual({
      audioLanguage: "en",
      subtitleLanguage: "en",
      secondarySubtitleLanguage: "fr",
      forcedSubtitlesOnly: false,
    })
    expect(
      titleLanguagePreferences(preferences, { audioLanguage: "ja", subtitleLanguage: "es" }),
    ).toEqual({
      audioLanguage: "ja",
      subtitleLanguage: "es",
      secondarySubtitleLanguage: "en",
      forcedSubtitlesOnly: false,
    })
    expect(
      titleLanguagePreferences(preferences, { subtitleLanguage: SUBTITLES_OFF })
        .secondarySubtitleLanguage,
    ).toBeNull()
  })

  it("lets a remembered subtitle pick override forced-only mode", () => {
    const preferences = { ...defaultPreferences, forcedSubtitlesOnly: true }
    expect(titleLanguagePreferences(preferences, {}).forcedSubtitlesOnly).toBe(true)
    expect(
      titleLanguagePreferences(preferences, { subtitleLanguage: "en" }).forcedSubtitlesOnly,
    ).toBe(false)
  })

  it("remembers the subtitle delay, including a reset to zero", () => {
    const storage = memoryStorage()
    rememberTitlePlayback("profile", "tt1", { subtitleDelayMs: 1300 }, storage)
    expect(readTitlePlayback("profile", "tt1", storage).subtitleDelayMs).toBe(1300)
    rememberTitlePlayback("profile", "tt1", { subtitleDelayMs: 0 }, storage)
    expect(readTitlePlayback("profile", "tt1", storage).subtitleDelayMs).toBe(0)
  })

  it("steps the delay in tenths of a second within ±30 s", () => {
    expect(stepSubtitleDelay(200, 100)).toBe(300)
    expect(stepSubtitleDelay(-100, 1000)).toBe(900)
    expect(stepSubtitleDelay(29_500, 1000)).toBe(30_000)
    expect([300, -1200, 0].map(formatSubtitleDelay)).toEqual(["+0.3 s", "−1.2 s", "0.0 s"])
  })

  it("turns subtitles off when the title was watched without them", () => {
    expect(
      preferredSubtitle({
        candidates: [{ track: "english", language: "en", embedded: true }],
        primary: SUBTITLES_OFF,
        secondary: null,
        embeddedReady: true,
        addonsReady: true,
      }),
    ).toBeNull()
  })
})
