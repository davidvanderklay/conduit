import { describe, expect, it } from "vitest"
import { downmixToStereo } from "./downmix"

/** One frame per channel, with only the named channel index sounding at full scale. */
function solo(channels: number, index: number, level = 0.5): Float32Array[] {
  return Array.from({ length: channels }, (_, channel) =>
    Float32Array.of(channel === index ? level : 0),
  )
}

describe("downmixToStereo", () => {
  it("routes 5.1 fronts, center, and surrounds to their sides and drops LFE", () => {
    const [frontLeft] = downmixToStereo(solo(6, 0))!
    const [centerLeft, centerRight] = downmixToStereo(solo(6, 2))!
    const [lfeLeft, lfeRight] = downmixToStereo(solo(6, 3))!
    const [surroundLeft, surroundRight] = downmixToStereo(solo(6, 5))!
    expect(frontLeft[0]).toBeGreaterThan(0)
    expect(centerLeft[0]).toBeCloseTo(centerRight[0])
    expect(centerLeft[0]).toBeCloseTo(frontLeft[0] * Math.SQRT1_2)
    expect([lfeLeft[0], lfeRight[0]]).toEqual([0, 0])
    expect([surroundLeft[0], surroundRight[0]]).toEqual([0, expect.any(Number)])
  })

  it("keeps 7.1 back and side channels on their own side", () => {
    const [backLeft, backRight] = downmixToStereo(solo(8, 4))!
    const [sideLeft, sideRight] = downmixToStereo(solo(8, 7))!
    expect(backLeft[0]).toBeGreaterThan(0)
    expect(backRight[0]).toBe(0)
    expect(sideLeft[0]).toBe(0)
    expect(sideRight[0]).toBeGreaterThan(0)
  })

  it("never exceeds full scale when every channel peaks together", () => {
    const loud = Array.from({ length: 8 }, () => Float32Array.of(1, -1))
    const [left, right] = downmixToStereo(loud)!
    for (const sample of [...left, ...right]) expect(Math.abs(sample)).toBeLessThanOrEqual(1)
  })

  it("leaves layouts it does not know to Web Audio", () => {
    expect(downmixToStereo(solo(10, 0))).toBeUndefined()
  })
})
