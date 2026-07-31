import { describe, expect, it } from "vitest"
import { isMeaningfullyInProgress } from "./poster-resume-button"

describe("poster resume indicator", () => {
  it("appears only after meaningful playback and before completion", () => {
    expect(isMeaningfullyInProgress(undefined)).toBe(false)
    expect(isMeaningfullyInProgress({ positionMs: 29_999, durationMs: 100_000, watched: false }))
      .toBe(false)
    expect(isMeaningfullyInProgress({ positionMs: 30_000, durationMs: 100_000, watched: false }))
      .toBe(true)
    expect(isMeaningfullyInProgress({ positionMs: 90_000, durationMs: 100_000, watched: false }))
      .toBe(false)
    expect(isMeaningfullyInProgress({ positionMs: 50_000, durationMs: 100_000, watched: true }))
      .toBe(false)
  })

  it("does not appear when duration is unknown", () => {
    expect(isMeaningfullyInProgress({ positionMs: 60_000, durationMs: 0, watched: false }))
      .toBe(false)
  })
})
