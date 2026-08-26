import { describe, expect, it } from "vitest"
import { subtitleVariantName, trackDisplayName } from "./track-display"

const subtitle = {
  id: 1,
  type: "sub" as const,
  lang: "en",
  selected: false,
  external: false,
}

describe("track display names", () => {
  it("replaces source URLs with the track language", () => {
    expect(trackDisplayName({ ...subtitle, title: "www.1TamilBlasters.land" }, "Subtitles 1"))
      .toBe("English")
  })

  it("shows embedded source labels as Embedded", () => {
    expect(subtitleVariantName({ ...subtitle, title: "www.1TamilBlasters.land" })).toBe(
      "Embedded",
    )
  })

  it("keeps a real external subtitle name and marks its source", () => {
    expect(
      subtitleVariantName({
        ...subtitle,
        title: "English · OpenSubtitles",
        external: true,
      }),
    ).toBe("English · OpenSubtitles · External")
  })
})
