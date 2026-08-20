import { describe, expect, it } from "vitest"
import { normalizeQueueItems } from "./route-modules/queue-routes.js"

describe("queue routes", () => {
  it("preserves order and removes duplicate playable items", () => {
    const first = { mediaType: "series" as const, mediaId: "show", videoId: "s1e1", name: "Show" }
    const movie = { mediaType: "movie" as const, mediaId: "movie", videoId: "movie", name: "Movie" }

    expect(normalizeQueueItems([first, movie, { ...first, name: "Duplicate" }])).toEqual([
      first,
      movie,
    ])
  })
})
