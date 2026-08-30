import { describe, expect, it } from "vitest"
import { activeSkipSegment, parseIntroDbSegments, shouldShowUpNext } from "./skip-segments"

describe("player skip segments", () => {
  const segments = parseIntroDbSegments({
    intro: { start_sec: 12, end_sec: 82 },
    outro: { start_ms: 2_400_000, end_ms: 2_430_000 },
  })

  it("parses seconds and milliseconds", () => {
    expect(segments).toEqual([
      { start: 12, end: 82, type: "intro" },
      { start: 2400, end: 2430, type: "outro" },
    ])
  })

  it("finds the active segment", () => {
    expect(activeSkipSegment(40, segments)?.type).toBe("intro")
    expect(activeSkipSegment(90, segments)).toBeUndefined()
  })

  it("shows Up Next at an outro that reaches the final window", () => {
    expect(shouldShowUpNext(2400, 2450, segments)).toBe(true)
    expect(shouldShowUpNext(2300, 2450, segments)).toBe(false)
  })

  it("falls back to the final thirty seconds when an outro ends early", () => {
    expect(shouldShowUpNext(2400, 3000, segments)).toBe(false)
    expect(shouldShowUpNext(2980, 3000, segments)).toBe(true)
  })
})
