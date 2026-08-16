import { describe, expect, it } from "vitest"
import type { WatchProgress } from "./api"
import type { Video } from "./core"
import {
  adjacentSeriesVideo,
  eligibleSeriesVideos,
  nextSeriesVideo,
  selectSeriesVideo,
} from "./metadata"

const NOW = new Date("2026-07-30T12:00:00Z")

function row(
  videoId: string,
  watched: boolean,
  updatedAt = "2026-07-01T00:00:00Z",
  season?: number,
  episode?: number,
): WatchProgress {
  return {
    videoId, mediaType: "series", mediaId: "show", name: "Show",
    season, episode,
    positionMs: watched ? 1_000 : 1_500, durationMs: 1_000, watched, updatedAt,
  }
}

describe("series resume selection", () => {
  const videos: Video[] = [
    { id: "s1e2", season: 1, episode: 2 },
    { id: "s2e1", season: 2, episode: 1 },
    { id: "s1e1", season: 1, episode: 1 },
  ]

  it("resumes an incomplete episode", () => {
    expect(selectSeriesVideo(videos, [row("s1e1", false)], undefined, NOW)?.id).toBe("s1e1")
  })

  it("honors an explicit episode link instead of replacing it with another resume", () => {
    expect(selectSeriesVideo(videos, [row("s1e1", false)], "s2e1", NOW)?.id).toBe("s2e1")
  })

  it("advances completed episodes across season boundaries", () => {
    expect(selectSeriesVideo(videos, [row("s1e1", true)], undefined, NOW)?.id).toBe("s1e2")
    expect(selectSeriesVideo(videos, [
      row("s1e1", true, "2026-07-01T00:00:00Z"),
      row("s1e2", true, "2026-07-02T00:00:00Z"),
    ], undefined, NOW)?.id)
      .toBe("s2e1")
  })

  it("falls back to the first episode when fully caught up", () => {
    expect(selectSeriesVideo(videos, videos.map((video) => row(video.id, true)), undefined, NOW)?.id)
      .toBe("s1e1")
  })

  it("selects the next unwatched episode after the current episode", () => {
    expect(nextSeriesVideo(videos, "s1e2", [], NOW)?.id).toBe("s2e1")
  })

  it("uses immediate metadata neighbors for sequential playback even when watched", () => {
    expect(adjacentSeriesVideo(videos, "s1e2", 1, NOW)?.id).toBe("s2e1")
    expect(adjacentSeriesVideo(videos, "s2e1", -1, NOW)?.id).toBe("s1e2")
  })

  it("advances from the latest completed episode instead of returning to an older gap", () => {
    expect(selectSeriesVideo(videos, [
      row("s1e1", false, "2026-07-01T00:00:00Z"),
      row("s1e2", true, "2026-07-02T00:00:00Z"),
    ], undefined, NOW)?.id).toBe("s2e1")
  })

  it("ignores specials, unavailable, future, and unnumbered videos", () => {
    const candidates: Video[] = [
      { id: "special", season: 0, episode: 1 },
      { id: "unavailable", season: 1, episode: 1, available: false },
      { id: "future", season: 1, episode: 2, released: "2026-08-01" },
      { id: "missing", season: 1 },
      { id: "eligible", season: 1, episode: 3, released: "2026-07-01" },
    ]
    expect(eligibleSeriesVideos(candidates, NOW).map((video) => video.id)).toEqual(["eligible"])
  })

  it("uses the furthest completed episode instead of the latest timestamp", () => {
    const episodes: Video[] = [
      { id: "s1e1", season: 1, episode: 1 },
      { id: "s1e3", season: 1, episode: 3 },
      { id: "s1e4", season: 1, episode: 4 },
    ]
    expect(selectSeriesVideo(episodes, [
      row("s1e1", true, "2026-07-03T00:00:00Z"),
      row("s1e3", true, "2026-07-02T00:00:00Z"),
    ], undefined, NOW)?.id).toBe("s1e4")
  })

  it("does not resume stale unfinished progress over a newer completion", () => {
    const episodes: Video[] = [
      { id: "s1e1", season: 1, episode: 1 },
      { id: "s1e2", season: 1, episode: 2 },
      { id: "s1e3", season: 1, episode: 3 },
    ]
    expect(selectSeriesVideo(episodes, [
      row("s1e1", false, "2026-07-01T00:00:00Z"),
      row("s1e2", true, "2026-07-02T00:00:00Z"),
    ], undefined, NOW)?.id).toBe("s1e3")
  })

  it("uses a valid metadata default before the first regular episode", () => {
    const episodes: Video[] = [
      { id: "s1e1", season: 1, episode: 1 },
      { id: "s1e5", season: 1, episode: 5 },
    ]
    expect(selectSeriesVideo(episodes, [], undefined, NOW, "s1e5")?.id).toBe("s1e5")
  })

  it("matches progress by season and episode when the raw video id changed", () => {
    const episodes: Video[] = [{ id: "new-id", season: 2, episode: 4 }]
    expect(selectSeriesVideo(episodes, [
      row("old-id", false, "2026-07-02T00:00:00Z", 2, 4),
    ], undefined, NOW)?.id).toBe("new-id")
  })

  it("prefers canonical coordinates when a raw id points at another episode", () => {
    const episodes: Video[] = [
      { id: "old-id", season: 1, episode: 1 },
      { id: "new-id", season: 2, episode: 4 },
    ]
    expect(selectSeriesVideo(episodes, [
      row("old-id", false, "2026-07-02T00:00:00Z", 2, 4),
    ], undefined, NOW)?.id).toBe("new-id")
  })

  it("falls back to the first playable episode when a progress season is missing", () => {
    const episodes: Video[] = [
      { id: "s1e1", season: 1, episode: 1 },
      { id: "s2e1", season: 2, episode: 1 },
    ]
    expect(selectSeriesVideo(episodes, [
      row("missing", false, "2026-07-02T00:00:00Z", 9, 1),
    ], undefined, NOW)?.id).toBe("s1e1")
  })
})
