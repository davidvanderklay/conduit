import { describe, expect, it } from "vitest"
import { HdrPeakTracker } from "./hdr-metadata"

describe("HdrPeakTracker", () => {
  it("prefers MaxCLL over the mastering display and keeps it for later frames", () => {
    const tracker = new HdrPeakTracker()
    expect(tracker.update([0, 0, 0])).toBeUndefined()
    expect(tracker.update([0, 0, 4000])).toBe(4000)
    expect(tracker.update([0, 1200, 4000])).toBe(1200)
    expect(tracker.update([0, 0, 0])).toBe(1200)
  })

  it("follows HDR10+ scene peaks, which persist until the next one", () => {
    const tracker = new HdrPeakTracker()
    tracker.update([0, 1000, 4000])
    expect(tracker.update([650, 0, 0])).toBe(650)
    expect(tracker.update([0, 0, 0])).toBe(650)
    expect(tracker.update([2400, 0, 0])).toBe(2400)
  })
})
