import { describe, expect, it } from "vitest"
import type { WatchProgress } from "./api"
import {
  completionEpisodeIds,
  episodeProgressPercent,
  episodeWatchState,
  posterWatchState,
  resumePositionLabel,
  seasonWatchVideos,
  seriesWatchVideos,
} from "./watch-status"

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

describe("episode watch state", () => {
  it("distinguishes not started, in progress, and watched", () => {
    expect(episodeWatchState()).toBe("not-started")
    expect(episodeWatchState(progress({ videoId: "partial", positionMs: 25, durationMs: 100 })))
      .toBe("in-progress")
    expect(episodeProgressPercent(progress({ videoId: "partial", positionMs: 125, durationMs: 100 })))
      .toBe(100)
    expect(episodeWatchState(progress({ videoId: "complete", watched: true }))).toBe("watched")
    expect(episodeProgressPercent(progress({ videoId: "complete", watched: true, positionMs: 1, durationMs: 2 })))
      .toBe(0)
  })

  it("formats an unfinished position for resume prompts", () => {
    expect(resumePositionLabel(progress({ videoId: "short", positionMs: 6_900 }))).toBe("0:06")
    expect(resumePositionLabel(progress({ videoId: "long", positionMs: 65_000 }))).toBe("1:05")
    expect(resumePositionLabel(progress({ videoId: "hour-long", positionMs: 3_908_000 }))).toBe("1:05:08")
    expect(resumePositionLabel()).toBeUndefined()
    expect(resumePositionLabel(progress({ videoId: "watched", positionMs: 6_000, watched: true })))
      .toBeUndefined()
  })

  it("selects every released episode in one season", () => {
    const videos = [
      { id: "s1e1", season: 1, episode: 1, released: "2026-01-01" },
      { id: "s1e2", season: 1, episode: 2, released: "2026-01-01" },
      { id: "s1e3", season: 1, episode: 3, released: "2027-01-01" },
      { id: "s2e1", season: 2, episode: 1, released: "2026-01-01" },
      { id: "unavailable", season: 1, episode: 4, available: false },
    ]
    expect(seasonWatchVideos(videos, 1, Date.parse("2026-06-01")))
      .toEqual([videos[0], videos[1]])
  })

  it("uses regular episodes for series actions while preserving specials-only titles", () => {
    const regular = [
      { id: "special", season: 0, episode: 1 },
      { id: "episode", season: 1, episode: 1 },
    ]
    expect(seriesWatchVideos(regular).map((video) => video.id)).toEqual(["episode"])
    expect(completionEpisodeIds([{ id: "special", season: 0, episode: 1 }])).toEqual(["special"])
  })
})
