import { describe, expect, it } from "vitest"
import { filterContinueWatching, isPlaybackComplete, shouldKeepContinueWatching } from "./routes.js"

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
    expect(isPlaybackComplete(Number.NaN, 100_000)).toBe(false)
    expect(isPlaybackComplete(100_000, Number.POSITIVE_INFINITY)).toBe(false)
    expect(isPlaybackComplete(-1, 100_000)).toBe(false)
  })
})

describe("continue watching", () => {
  it("keeps sticky members regardless of completion or age", () => {
    const rows = [
      { videoId: "old-partial", continueWatching: true, dismissed: false, updatedAt: new Date("2020-01-02") },
      { videoId: "completed-movie", continueWatching: true, dismissed: false, updatedAt: new Date("2026-01-04") },
      { videoId: "completed-final-episode", continueWatching: true, dismissed: false, updatedAt: new Date("2026-01-06") },
      { videoId: "not-eligible", continueWatching: false, dismissed: false, updatedAt: new Date("2026-01-07") },
      { videoId: "dismissed", continueWatching: true, dismissed: true, updatedAt: new Date("2026-01-08") },
    ]

    expect(filterContinueWatching(rows, 10).map((row) => row.videoId)).toEqual([
      "completed-final-episode",
      "completed-movie",
      "old-partial",
    ])
  })

  it("adds membership at the first meaningful progress or watched state", () => {
    expect(shouldKeepContinueWatching(false, false, 29_999)).toBe(false)
    expect(shouldKeepContinueWatching(false, false, 30_000)).toBe(true)
    expect(shouldKeepContinueWatching(false, true, 0)).toBe(true)
    expect(shouldKeepContinueWatching(true, false, 0)).toBe(true)
  })
})
