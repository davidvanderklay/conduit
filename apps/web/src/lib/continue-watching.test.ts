import { describe, expect, it } from "vitest"
import type { WatchProgress } from "./api"
import type { Video } from "./core"
import {
  continueWatchingState,
  groupContinueWatching,
  releaseDateLabel,
  remainingTimeLabel,
} from "./continue-watching"

const NOW = new Date(2026, 7, 12, 12)

function progress(overrides: Partial<WatchProgress> = {}): WatchProgress {
  return {
    videoId: "s1e2",
    mediaType: "series",
    mediaId: "show",
    name: "Show",
    season: 1,
    episode: 2,
    positionMs: 0,
    durationMs: 24 * 60_000,
    watched: true,
    updatedAt: "2026-08-12T12:00:00Z",
    ...overrides,
  }
}

const videos: Video[] = [
  { id: "special", season: 0, episode: 1 },
  { id: "s1e2", season: 1, episode: 2, thumbnail: "episode-2.jpg" },
  { id: "s1e3", season: 1, episode: 3, released: "2026-08-11" },
  { id: "s1e4", season: 1, episode: 4, released: "2026-08-13" },
]

describe("Continue Watching state", () => {
  it("groups a series around only its most recently watched episode", () => {
    const grouped = groupContinueWatching([
      progress({ videoId: "s1e1", updatedAt: "2026-08-10T12:00:00Z" }),
      progress({ videoId: "s1e2", updatedAt: "2026-08-12T12:00:00Z" }),
      progress({ mediaType: "movie", mediaId: "movie", videoId: "movie" }),
    ])
    expect(grouped.map((item) => item.videoId)).toEqual(["s1e2", "movie"])
  })

  it("keeps an unfinished anchor in progress and uses its episode image", () => {
    expect(continueWatchingState(progress({ watched: false }), videos, NOW)).toEqual({
      kind: "in-progress",
      video: videos[1],
    })
  })

  it("shows the first released episode after the completed anchor as new", () => {
    expect(continueWatchingState(progress(), videos, NOW)).toEqual({
      kind: "new-episode",
      video: videos[2],
    })
  })

  it("does not inspect gaps before the completed anchor", () => {
    const withGap = [{ id: "s1e1", season: 1, episode: 1 }, ...videos]
    expect(continueWatchingState(progress(), withGap, NOW).kind).toBe("new-episode")
  })

  it("shows a known future release after the user catches up", () => {
    const state = continueWatchingState(progress({ videoId: "s1e3", episode: 3 }), videos, NOW)
    expect(state).toEqual({ kind: "scheduled", video: videos[3], label: "Tomorrow" })
  })

  it("keeps a date-only episode scheduled for Today until availability is known", () => {
    const today = { id: "s1e3", season: 1, episode: 3, released: "2026-08-12" }
    expect(continueWatchingState(progress(), [videos[1]!, today], NOW)).toEqual({
      kind: "scheduled",
      video: today,
      label: "Today",
    })
    expect(continueWatchingState(progress(), [videos[1]!, { ...today, available: true }], NOW).kind)
      .toBe("new-episode")
  })

  it("falls back to caught up when no later episode is known", () => {
    expect(continueWatchingState(progress({ videoId: "s1e4", episode: 4 }), videos, NOW)).toEqual({
      kind: "caught-up",
      video: videos[3],
    })
  })

  it("formats remaining time and calendar-relative dates", () => {
    expect(
      remainingTimeLabel(progress({ watched: false, positionMs: 30_000, durationMs: 60_000 })),
    ).toBe("1 min left")
    expect(
      remainingTimeLabel(progress({ watched: false, positionMs: 0, durationMs: 84 * 60_000 })),
    ).toBe("1h 24m left")
    expect(releaseDateLabel("2026-08-12", NOW)).toBe("Today")
    expect(releaseDateLabel("2026-08-13", NOW)).toBe("Tomorrow")
    expect(releaseDateLabel("2026-08-19", NOW)).toMatch(/Aug 19/)
  })
})
