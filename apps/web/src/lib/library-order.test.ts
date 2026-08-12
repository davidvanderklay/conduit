import { describe, expect, it } from "vitest"
import type { LibraryItem, WatchProgress } from "./api"
import { orderLibraryItems } from "./library-order"

const items = [
  item("movie", "movie", "Movie"),
  item("complete", "series", "Complete"),
  item("partial", "series", "Partial"),
  item("untouched", "series", "Untouched"),
]
const progress = [
  watched("movie", "movie", "movie", "2026-01-04"),
  watched("complete:1", "complete", "series", "2026-01-03"),
  watched("partial:1", "partial", "series", "2026-01-02"),
  watched("partial:2", "partial", "series", "2026-01-01", false, 50),
]
const episodeIds = new Map([
  ["series:complete", ["complete:1"]],
  ["series:partial", ["partial:1", "partial:2"]],
])

describe("library ordering", () => {
  it("sorts names in both directions", () => {
    expect(orderLibraryItems(items, progress, "name").map(({ id }) => id))
      .toEqual(["complete", "movie", "partial", "untouched"])
    expect(orderLibraryItems(items, progress, "name-desc").map(({ id }) => id))
      .toEqual(["untouched", "partial", "movie", "complete"])
  })

  it("puts the most recently watched titles first", () => {
    expect(orderLibraryItems(items, progress, "last-watched").map(({ id }) => id))
      .toEqual(["movie", "complete", "partial", "untouched"])
  })

  it("puts only complete titles first when sorting by watched", () => {
    expect(orderLibraryItems(items, progress, "watched", episodeIds).map(({ id }) => id))
      .toEqual(["movie", "complete", "partial", "untouched"])
  })

  it("includes partial and untouched titles when sorting by not watched", () => {
    expect(orderLibraryItems(items, progress, "not-watched", episodeIds).map(({ id }) => id))
      .toEqual(["partial", "untouched", "movie", "complete"])
  })
})

function item(id: string, type: LibraryItem["type"], name: string): LibraryItem {
  return {
    id,
    type,
    name,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
  }
}

function watched(
  videoId: string,
  mediaId: string,
  mediaType: string,
  updatedAt: string,
  isWatched = true,
  positionMs = 0,
): WatchProgress {
  return {
    videoId,
    mediaId,
    mediaType,
    name: mediaId,
    positionMs,
    durationMs: 100,
    watched: isWatched,
    updatedAt,
  }
}
