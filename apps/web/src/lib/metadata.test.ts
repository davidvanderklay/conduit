import { describe, expect, it } from "vitest"
import {
  fullMetadataFixture,
  malformedMetadataFixture,
  partialMetadataFixture,
} from "./metadata.fixtures"
import {
  displayDate,
  episodeLabel,
  normalizeMetaItem,
  safeExternalUrl,
  seasonLabel,
  sortSeasons,
  trailerUrl,
} from "./metadata"

const fallback = {
  id: "fallback",
  type: "series",
  name: "Fallback title",
  poster: "https://fallback.example/poster.jpg",
}

describe("add-on metadata normalization", () => {
  it("preserves full movie, series, and episode metadata", () => {
    const meta = normalizeMetaItem(fullMetadataFixture, fallback)

    expect(meta).toMatchObject({
      id: "tt-full",
      type: "series",
      name: "A Complete Series",
      releaseInfo: "2026",
      runtime: "48 min",
      imdbRating: "8.7",
      contentRating: "TV-MA",
      genres: ["Drama", "Mystery"],
      director: ["Ada Director"],
      cast: ["Casey Lead", "Robin Guest"],
      writer: ["Wren Writer", "Pat Author"],
    })
    expect(meta.videos?.[0]).toMatchObject({
      id: "tt-full:1:1",
      title: "The Beginning",
      overview: "Everything begins here.",
      season: 1,
      episode: 1,
      runtime: "49 min",
      available: true,
    })
    expect(trailerUrl(meta)).toBe("https://www.youtube.com/watch?v=abcDEF_1234")
  })

  it("uses useful fallbacks for partial metadata", () => {
    const meta = normalizeMetaItem(partialMetadataFixture, fallback)

    expect(meta.type).toBe("series")
    expect(meta.poster).toBe("https://fallback.example/poster.jpg")
    expect(meta.videos?.[0]?.title).toBe("Episode 1")
    expect(episodeLabel(meta.videos![0]!)).toBe("Episode 1")
  })

  it("drops malformed records and unsafe external URLs without dropping navigation", () => {
    const meta = normalizeMetaItem(malformedMetadataFixture, fallback)

    expect(meta.id).toBe("fallback")
    expect(meta.name).toBe("Fallback title")
    expect(meta.poster).toBe("https://fallback.example/poster.jpg")
    expect(meta.background).toBeUndefined()
    expect(meta.genres).toEqual(["Drama"])
    expect(meta.director).toEqual(["One Director", "Two Director"])
    expect(meta.videos).toHaveLength(1)
    expect(meta.videos?.[0]).toMatchObject({
      id: "safe:1",
      title: "<b>Displayed as text</b>",
      season: 1,
      episode: 2,
      released: "sometime",
    })
    expect(meta.videos?.[0]?.thumbnail).toBeUndefined()
  })

  it("allows only http(s) external URLs and tolerates unparseable dates", () => {
    expect(safeExternalUrl("https://example.com/watch")).toBe("https://example.com/watch")
    expect(safeExternalUrl("javascript:alert(1)")).toBeUndefined()
    expect(safeExternalUrl("data:text/html,bad")).toBeUndefined()
    expect(displayDate("not-a-date")).toBe("not-a-date")
  })

  it("places season zero after numbered seasons and labels it as Specials", () => {
    expect(sortSeasons([0, 3, 1, 2, 0])).toEqual([1, 2, 3, 0])
    expect(seasonLabel(0)).toBe("Specials")
    expect(seasonLabel(2)).toBe("Season 2")
    expect(episodeLabel({ id: "special", season: 0, episode: 4 })).toBe("Special 4")
  })
})
