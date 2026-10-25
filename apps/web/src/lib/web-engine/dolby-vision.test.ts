import { describe, expect, it } from "vitest"
import { DOLBY_VISION_FLOATS, dolbyVisionPeak, hasDolbyVisionRpu } from "./dolby-vision"

/** Length-prefixes NAL units the way hvcC-configured HEVC packets carry them. */
function accessUnit(...nals: number[][]): Uint8Array {
  return Uint8Array.from(nals.flatMap((nal) => [0, 0, 0, nal.length, ...nal]))
}

describe("hasDolbyVisionRpu", () => {
  it("finds the RPU among the slices of an access unit", () => {
    const slice = [0x26, 0x01, 0xaf]
    const rpu = [62 << 1, 0x01, 0x19, 0x08]
    expect(hasDolbyVisionRpu(accessUnit(slice, rpu))).toBe(true)
    expect(hasDolbyVisionRpu(accessUnit(slice))).toBe(false)
  })
})

describe("dolbyVisionPeak", () => {
  it("prefers the scene's level 1 peak over the source peak", () => {
    const metadata = new Float32Array(DOLBY_VISION_FLOATS)
    metadata[1] = 3079 / 4095
    metadata[2] = -1
    expect(dolbyVisionPeak(metadata)).toBeCloseTo(1000, -1)
    metadata[2] = 2081 / 4095
    expect(dolbyVisionPeak(metadata)).toBeCloseTo(100, -1)
  })
})
