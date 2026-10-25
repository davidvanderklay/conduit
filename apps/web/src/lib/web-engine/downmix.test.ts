import { describe, expect, it } from "vitest"
import { downmix71To51, downmixToStereo } from "./downmix"

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

describe("downmix71To51", () => {
  it("folds each side's back and side surrounds into its 5.1 surround", () => {
    const channels = downmix71To51(solo(8, 4))
    expect(channels).toHaveLength(6)
    expect(channels[4][0]).toBeCloseTo(0.5 * Math.SQRT1_2)
    expect(channels[5][0]).toBe(0)
    expect(downmix71To51(solo(8, 7))[5][0]).toBeCloseTo(0.5 * Math.SQRT1_2)
    expect(downmix71To51(solo(8, 2))[2][0]).toBe(0.5)
  })
})
