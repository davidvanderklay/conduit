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

function row(videoId: string, watched: boolean, updatedAt = "2026-07-01T00:00:00Z"): WatchProgress {
  return {
    videoId, mediaType: "series", mediaId: "show", name: "Show",
    positionMs: watched ? 1_000 : 500, durationMs: 1_000, watched, updatedAt,
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

  it("returns no target when fully caught up", () => {
    expect(selectSeriesVideo(videos, videos.map((video) => row(video.id, true)), undefined, NOW))
      .toBeUndefined()
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
})
