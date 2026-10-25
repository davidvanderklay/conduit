import { beforeAll, describe, expect, it } from "vitest"
import { PgsDecoder } from "./pgs"

// Node has no ImageData; the decoder only needs its constructor's shape.
beforeAll(() => {
  globalThis.ImageData ??= class {
    constructor(
      readonly data: Uint8ClampedArray,
      readonly width: number,
      readonly height: number,
    ) {}
  } as unknown as typeof ImageData
})

const segment = (type: number, data: number[]) => [
  type,
  data.length >> 8,
  data.length & 0xff,
  ...data,
]

/** A display set placing a 4x2 object (white, white, red run of 2; then a line of 4 transparent) at (10, 20). */
function displaySet() {
  const composition = [5, 0, 2, 208, 0x10, 0, 1, 0x80, 0, 0, 1, 0, 0, 0, 0, 0, 10, 0, 20]
  const palette = [0, 0, 1, 235, 128, 128, 255, 2, 81, 240, 90, 255]
  const rle = [1, 1, 0, 0x82, 2, 0, 0, 0, 4, 0, 0]
  const object = [0, 0, 0, 0xc0, 0, 0, rle.length + 4, 0, 4, 0, 2, ...rle]
  return Uint8Array.from([
    ...segment(0x16, composition),
    ...segment(0x14, palette),
    ...segment(0x15, object),
    ...segment(0x80, []),
  ])
}

describe("PgsDecoder", () => {
  it("places a run-length decoded, palette-converted object on the frame", () => {
    const composition = new PgsDecoder().decode(displaySet())!
    expect([composition.videoWidth, composition.videoHeight]).toEqual([1280, 720])
    const [object] = composition.objects
    expect([object.x, object.y, object.image.width, object.image.height]).toEqual([10, 20, 4, 2])
    const pixel = (index: number) => Array.from(object.image.data.slice(index * 4, index * 4 + 4))
    expect(pixel(0)).toEqual([255, 255, 255, 255])
    expect(pixel(2)[0]).toBeGreaterThan(240)
    expect(pixel(2)[1]).toBeLessThan(40)
    expect(pixel(4)[3]).toBe(0)
  })

  it("clears the screen for a composition without objects", () => {
    const clear = Uint8Array.from(segment(0x16, [5, 0, 2, 208, 0x10, 0, 2, 0, 0, 0, 0]))
    expect(new PgsDecoder().decode(clear)?.objects).toEqual([])
  })
})
