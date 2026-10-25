/**
 * Decodes Blu-ray PGS (Presentation Graphic Stream) subtitles: each display set
 * is a run of segments that place palette-indexed, run-length encoded bitmaps
 * on the video frame.
 */

/** A bitmap placed on the video frame, in the frame's pixel coordinates. */
export interface PgsObject {
  x: number
  y: number
  image: ImageData
}

/** What a display set shows: bitmaps on a frame of the given size, or nothing once cleared. */
export interface PgsComposition {
  videoWidth: number
  videoHeight: number
  objects: PgsObject[]
}

interface ObjectData {
  width: number
  height: number
  rle: Uint8Array
}

const PALETTE = 0x14
const OBJECT = 0x15
const COMPOSITION = 0x16
const FIRST_FRAGMENT = 0x80

/**
 * Palettes and objects outlive the display set that defines them, so later sets
 * can update a palette or move an object; the decoder keeps them per track.
 */
export class PgsDecoder {
  readonly #palettes = new Map<number, Uint32Array>()
  readonly #objects = new Map<number, ObjectData>()

  /** Decodes one display set (a Matroska block's payload). */
  decode(data: Uint8Array): PgsComposition | undefined {
    let composition:
      | {
          width: number
          height: number
          palette: number
          placements: { id: number; x: number; y: number }[]
        }
      | undefined
    let offset = 0
    while (offset + 3 <= data.byteLength) {
      const type = data[offset]
      const size = (data[offset + 1] << 8) | data[offset + 2]
      const segment = data.subarray(offset + 3, offset + 3 + size)
      offset += 3 + size
      if (type === COMPOSITION && segment.byteLength >= 11) {
        const placements: { id: number; x: number; y: number }[] = []
        let position = 11
        for (let index = 0; index < segment[10] && position + 8 <= segment.byteLength; index += 1) {
          const cropped = segment[position + 3] & 0x80
          placements.push({
            id: (segment[position] << 8) | segment[position + 1],
            x: (segment[position + 4] << 8) | segment[position + 5],
            y: (segment[position + 6] << 8) | segment[position + 7],
          })
          position += cropped ? 16 : 8
        }
        composition = {
          width: (segment[0] << 8) | segment[1],
          height: (segment[2] << 8) | segment[3],
          palette: segment[9],
          placements,
        }
      } else if (type === PALETTE && segment.byteLength >= 2) {
        this.#palettes.set(segment[0], this.#palette(segment, composition?.height ?? 1080))
      } else if (type === OBJECT && segment.byteLength >= 4) {
        const id = (segment[0] << 8) | segment[1]
        if (segment[3] & FIRST_FRAGMENT) {
          if (segment.byteLength < 11) continue
          this.#objects.set(id, {
            width: (segment[7] << 8) | segment[8],
            height: (segment[9] << 8) | segment[10],
            rle: segment.slice(11),
          })
        } else {
          // Later fragments continue the run-length data of the same object.
          const object = this.#objects.get(id)
          if (object) object.rle = Uint8Array.from([...object.rle, ...segment.subarray(4)])
        }
      }
    }
    if (!composition) return undefined
    const palette = this.#palettes.get(composition.palette)
    const objects = palette
      ? composition.placements.flatMap(({ id, x, y }) => {
          const object = this.#objects.get(id)
          return object ? [{ x, y, image: decodeRle(object, palette) }] : []
        })
      : []
    return { videoWidth: composition.width, videoHeight: composition.height, objects }
  }

  /** Converts a palette segment's Y, Cr, Cb, alpha entries to RGBA, BT.709 for HD and BT.601 for SD. */
  #palette(segment: Uint8Array, videoHeight: number): Uint32Array {
    const palette = this.#palettes.get(segment[0])?.slice() ?? new Uint32Array(256)
    const [kr, kb] = videoHeight > 576 ? [0.2126, 0.0722] : [0.299, 0.114]
    const kg = 1 - kr - kb
    for (let offset = 2; offset + 5 <= segment.byteLength; offset += 5) {
      const y = ((segment[offset + 1] - 16) * 255) / 219
      const cr = ((segment[offset + 2] - 128) * 255) / 224
      const cb = ((segment[offset + 3] - 128) * 255) / 224
      const red = y + 2 * (1 - kr) * cr
      const blue = y + 2 * (1 - kb) * cb
      const green = (y - kr * red - kb * blue) / kg
      const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)))
      // ImageData is RGBA in memory, which a little-endian Uint32Array stores as ABGR.
      palette[segment[offset]] =
        ((segment[offset + 4] << 24) | (clamp(blue) << 16) | (clamp(green) << 8) | clamp(red)) >>> 0
    }
    return palette
  }
}

/** Expands PGS run-length data (Blu-ray format, a 0 byte escapes runs and line ends) to RGBA. */
export function decodeRle({ width, height, rle }: ObjectData, palette: Uint32Array): ImageData {
  const pixels = new Uint32Array(width * height)
  let x = 0
  let y = 0
  let offset = 0
  while (offset < rle.byteLength && y < height) {
    let color = rle[offset++]
    let length = 1
    if (color === 0) {
      const flags = rle[offset++]
      if (flags === 0) {
        x = 0
        y += 1
        continue
      }
      length = flags & 0x3f
      if (flags & 0x40) length = (length << 8) | rle[offset++]
      color = flags & 0x80 ? rle[offset++] : 0
    }
    const start = y * width + x
    pixels.fill(palette[color], start, start + Math.min(length, width - x))
    x += length
  }
  return new ImageData(new Uint8ClampedArray(pixels.buffer), width, height)
}
