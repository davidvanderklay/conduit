import { describe, expect, it } from "vitest"
import type { WatchProgress } from "./api"
import { completionEpisodeIds, posterWatchState } from "./watch-status"

function progress(values: Partial<WatchProgress> & Pick<WatchProgress, "videoId">): WatchProgress {
  return {
    videoId: values.videoId,
    mediaType: values.mediaType ?? "series",
    mediaId: values.mediaId ?? "show",
    name: "Show",
    positionMs: values.positionMs ?? 0,
    durationMs: values.durationMs ?? 0,
    watched: values.watched ?? false,
    updatedAt: "2026-01-01T00:00:00Z",
  }
}

describe("poster watch state", () => {
  it("treats movies as a binary watched state", () => {
    const movie = { id: "movie", type: "movie" }
    expect(posterWatchState([], movie)).toBe("unwatched")
    expect(
      posterWatchState(
        [progress({ videoId: "movie", mediaId: "movie", mediaType: "movie", watched: true })],
        movie,
      ),
    ).toBe("complete")
  })

  it("distinguishes partial and automatically complete series state", () => {
    const series = { id: "show", type: "series" }
    expect(posterWatchState([progress({ videoId: "show:1:1", positionMs: 30_000 })], series))
      .toBe("partial")
    expect(
      posterWatchState(
        [
          progress({ videoId: "show:1:1", watched: true }),
          progress({ videoId: "show:1:2", watched: true }),
        ],
        series,
        ["show:1:1", "show:1:2"],
      ),
    ).toBe("complete")
  })

  it("does not require specials, unavailable, or future episodes for completion", () => {
    expect(
      completionEpisodeIds(
        [
          { id: "regular", season: 1, episode: 1, released: "2026-01-01" },
          { id: "special", season: 0, episode: 1 },
          { id: "unavailable", season: 1, episode: 2, available: false },
          { id: "future", season: 1, episode: 3, released: "2027-01-01" },
        ],
        Date.parse("2026-06-01"),
      ),
    ).toEqual(["regular"])
  })
})
