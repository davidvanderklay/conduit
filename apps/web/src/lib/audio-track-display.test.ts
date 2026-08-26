import { describe, expect, it } from "vitest"
import { audioTrackDisplay } from "./audio-track-display"

describe("audio track display", () => {
  it("formats technical metadata and the full language name", () => {
    expect(
      audioTrackDisplay(
        {
          id: 1,
          type: "audio",
          title: "Dolby Digital",
          lang: "hu",
          codec: "ac3",
          audioChannels: "5.1(side)",
          channelCount: 6,
          sampleRate: 48_000,
          bitrate: 640_000,
          selected: true,
          external: false,
        },
        "Audio 1",
      ),
    ).toEqual({
      primary: "Dolby Digital (5.1(side), 48 kHz, 640 kbps, AC-3)",
      secondary: "Hungarian",
    })
  })

  it("appends the codec when the authored title is only a language", () => {
    expect(
      audioTrackDisplay(
        {
          id: 2,
          type: "audio",
          title: "English",
          lang: "en",
          codec: "truehd",
          channelCount: 8,
          selected: false,
          external: false,
        },
        "Audio 2",
      ),
    ).toEqual({
      primary: "English (7.1, TrueHD)",
      secondary: "English",
    })
  })

  it("uses the language when a source publishes its URL as the title", () => {
    expect(
      audioTrackDisplay(
        {
          id: 3,
          type: "audio",
          title: "https://example.com/audio",
          lang: "en",
          channelCount: 2,
          selected: false,
          external: false,
        },
        "Audio 3",
      ),
    ).toEqual({
      primary: "English (Stereo)",
      secondary: "English",
    })
  })
})
