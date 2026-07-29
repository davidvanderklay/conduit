import { describe, expect, it } from "vitest"
import { nativeMediaTitle, playerHeading } from "./player-title"

describe("player headings", () => {
  it("uses the canonical movie title", () => {
    const metadata = { mediaType: "movie", mediaId: "tt1", name: "The Movie" }
    expect(playerHeading(metadata)).toEqual({ primary: "The Movie" })
    expect(nativeMediaTitle(metadata)).toBe("The Movie")
  })

  it("shows the series, episode number, and episode title", () => {
    const metadata = {
      mediaType: "series",
      mediaId: "tt2",
      name: "The Show",
      videoTitle: "The Beginning",
      season: 1,
      episode: 2,
    }
    expect(playerHeading(metadata)).toEqual({
      primary: "The Show",
      secondary: "S1 E2 · The Beginning",
    })
    expect(nativeMediaTitle(metadata)).toBe("The Show — S1 E2 · The Beginning")
  })
})
