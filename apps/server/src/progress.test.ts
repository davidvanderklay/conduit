import { describe, expect, it } from "vitest"
import { filterContinueWatching, isPlaybackComplete } from "./routes.js"

describe("watch completion", () => {
  it("completes at ninety percent", () => {
    expect(isPlaybackComplete(90_000, 100_000)).toBe(true)
    expect(isPlaybackComplete(89_999, 1_000_000)).toBe(false)
  })

  it("completes near the credits", () => {
    expect(isPlaybackComplete(480_000, 600_000)).toBe(true)
    expect(isPlaybackComplete(479_999, 600_000)).toBe(false)
  })

  it("does not complete media without a known duration", () => {
    expect(isPlaybackComplete(100_000, 0)).toBe(false)
  })
})

describe("continue watching", () => {
  it("keeps only resumable latest-per-title rows and restores recency order", () => {
    const rows = [
      { videoId: "show-episode-2", positionMs: 60_000, watched: false, updatedAt: new Date("2026-01-02") },
      { videoId: "completed-show", positionMs: 100_000, watched: true, updatedAt: new Date("2026-01-04") },
      { videoId: "movie", positionMs: 45_000, watched: false, updatedAt: new Date("2026-01-03") },
      { videoId: "barely-started", positionMs: 10_000, watched: false, updatedAt: new Date("2026-01-05") },
    ]

    expect(filterContinueWatching(rows, 10).map((row) => row.videoId)).toEqual([
      "movie",
      "show-episode-2",
    ])
  })
})
