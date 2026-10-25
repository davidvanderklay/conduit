/**
 * A minimal Matroska (EBML) reader over HTTP range requests, for the metadata
 * Mediabunny does not expose: subtitle tracks, codec private data, and cues.
 */

/** Element IDs, keeping their EBML length marker bits. */
export const ID = {
  segment: 0x18538067,
  seekHead: 0x114d9b74,
  seek: 0x4dbb,
  seekId: 0x53ab,
  seekPosition: 0x53ac,
  info: 0x1549a966,
  timestampScale: 0x2ad7b1,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackNumber: 0xd7,
  trackType: 0x83,
  codecId: 0x86,
  codecPrivate: 0x63a2,
  language: 0x22b59c,
  languageBcp47: 0x22b59d,
  name: 0x536e,
  flagDefault: 0x88,
  flagForced: 0x55aa,
  video: 0xe0,
  colour: 0x55b0,
  maxCll: 0x55bc,
  masteringMetadata: 0x55d0,
  luminanceMax: 0x55d9,
  cues: 0x1c53bb6b,
  cuePoint: 0xbb,
  cueTime: 0xb3,
  cueTrackPositions: 0xb7,
  cueTrack: 0xf7,
  cueClusterPosition: 0xf1,
  cueRelativePosition: 0xf0,
  cueDuration: 0xb2,
  simpleBlock: 0xa3,
  blockGroup: 0xa0,
  block: 0xa1,
  blockDuration: 0x9b,
} as const

export interface MatroskaTrack {
  number: number
  type: number
  codec: string
  codecPrivate?: Uint8Array
  language: string
  name: string
  default: boolean
  forced: boolean
  /** HDR peaks in nits from the video track's Colour element: [MaxCLL, mastering display peak]. */
  hdrPeaks?: [maxCll: number, mastering: number]
}

const HEADER_BYTES = 256 * 1024

/** A Matroska file's segment layout, with its top-level elements loaded on demand. */
export class MatroskaFile {
  readonly url: string
  /** Offset of the segment's data, which seek and cue positions are relative to. */
  readonly segmentStart: number
  readonly #positions: Map<number, number>

  private constructor(url: string, segmentStart: number, positions: Map<number, number>) {
    this.url = url
    this.segmentStart = segmentStart
    this.#positions = positions
  }

  /** Reads the file header and seek head. Resolves undefined for files that are not Matroska. */
  static async open(url: string): Promise<MatroskaFile | undefined> {
    const head = await readRange(url, 0, HEADER_BYTES)
    const segment = elements(head, 0, head.byteLength).find((element) => element.id === ID.segment)
    if (!segment) return undefined
    // Top-level elements in the header, plus where the seek head says the rest live.
    const positions = new Map<number, number>()
    for (const element of elements(head, segment.dataStart, head.byteLength)) {
      positions.set(element.id, element.start)
      if (element.id !== ID.seekHead) continue
      for (const seek of elements(head, element.dataStart, element.end)) {
        if (seek.id !== ID.seek) continue
        let id = 0
        let position = 0
        for (const field of elements(head, seek.dataStart, seek.end)) {
          if (field.id === ID.seekId) id = readUint(head, field)
          if (field.id === ID.seekPosition) position = readUint(head, field)
        }
        if (id && !positions.has(id)) positions.set(id, segment.dataStart + position)
      }
    }
    return new MatroskaFile(url, segment.dataStart, positions)
  }

  /** Reads a whole top-level element, such as Tracks or Cues. */
  async load(id: number): Promise<{ data: Uint8Array; element: Element } | undefined> {
    const position = this.#positions.get(id)
    if (position === undefined) return undefined
    const header = await readRange(this.url, position, position + 16)
    const [element] = elements(header, 0, header.byteLength)
    if (!element || element.id !== id) return undefined
    const data = await readRange(this.url, position, position + element.declaredEnd)
    return { data, element: { ...element, end: data.byteLength } }
  }

  async tracks(): Promise<MatroskaTrack[]> {
    const loaded = await this.load(ID.tracks)
    if (!loaded) return []
    const { data, element } = loaded
    const tracks: MatroskaTrack[] = []
    for (const entry of elements(data, element.dataStart, data.byteLength)) {
      if (entry.id !== ID.trackEntry) continue
      const track: MatroskaTrack = {
        number: 0,
        type: 0,
        codec: "",
        language: "eng",
        name: "",
        default: true,
        forced: false,
      }
      let bcp47 = ""
      for (const field of elements(data, entry.dataStart, entry.end)) {
        if (field.id === ID.trackNumber) track.number = readUint(data, field)
        if (field.id === ID.trackType) track.type = readUint(data, field)
        if (field.id === ID.codecId) track.codec = readString(data, field)
        if (field.id === ID.codecPrivate)
          track.codecPrivate = data.slice(field.dataStart, field.end)
        if (field.id === ID.language) track.language = readString(data, field)
        if (field.id === ID.languageBcp47) bcp47 = readString(data, field)
        if (field.id === ID.name) track.name = readString(data, field)
        if (field.id === ID.flagDefault) track.default = readUint(data, field) === 1
        if (field.id === ID.flagForced) track.forced = readUint(data, field) === 1
        if (field.id === ID.video) track.hdrPeaks = colourPeaks(data, field)
      }
      tracks.push({ ...track, language: bcp47 || track.language })
    }
    return tracks
  }

  /** Seconds per timestamp tick, from the segment's TimestampScale. */
  async secondsPerTick(): Promise<number> {
    const info = await this.load(ID.info)
    if (info) {
      for (const field of elements(info.data, info.element.dataStart, info.data.byteLength)) {
        if (field.id === ID.timestampScale) return readUint(info.data, field) / 1e9
      }
    }
    return 1e-3
  }
}

/** MaxCLL and the mastering display peak from a Video element's Colour, 0 when absent. */
function colourPeaks(data: Uint8Array, video: Element): [number, number] | undefined {
  const colour = elements(data, video.dataStart, video.end).find((field) => field.id === ID.colour)
  if (!colour) return undefined
  let maxCll = 0
  let mastering = 0
  for (const field of elements(data, colour.dataStart, colour.end)) {
    if (field.id === ID.maxCll) maxCll = readUint(data, field)
    if (field.id !== ID.masteringMetadata) continue
    for (const value of elements(data, field.dataStart, field.end)) {
      if (value.id === ID.luminanceMax) mastering = readFloat(data, value)
    }
  }
  return maxCll || mastering ? [maxCll, mastering] : undefined
}

function readFloat(data: Uint8Array, element: Element): number {
  const view = new DataView(
    data.buffer,
    data.byteOffset + element.dataStart,
    element.end - element.dataStart,
  )
  return view.byteLength === 4 ? view.getFloat32(0) : view.byteLength === 8 ? view.getFloat64(0) : 0
}

export interface Element {
  id: number
  start: number
  dataStart: number
  /** End of the element's data, clipped to the bytes read. */
  end: number
  /** End of the element's data in the file, past the bytes read when it is truncated. */
  declaredEnd: number
}

/** The EBML elements laid end to end in `[start, end)`, stopping at a truncated one. */
export function elements(data: Uint8Array, start: number, end: number): Element[] {
  const found: Element[] = []
  let offset = start
  while (offset < end) {
    const id = readVint(data, offset, true)
    const size = id && readVint(data, offset + id.length)
    if (!id || !size) break
    const dataStart = offset + id.length + size.length
    // An unknown size (all ones) runs to the end of the parent.
    const elementEnd = size.unknown ? end : dataStart + size.value
    found.push({
      id: id.value,
      start: offset,
      dataStart,
      end: Math.min(elementEnd, data.byteLength),
      declaredEnd: elementEnd,
    })
    if (elementEnd > data.byteLength) break
    offset = elementEnd
  }
  return found
}

/** An EBML variable-length integer; IDs keep their length marker bit. */
export function readVint(data: Uint8Array, offset: number, keepMarker = false) {
  const first = data[offset]
  if (first === undefined || first === 0) return undefined
  const length = Math.clz32(first) - 23
  if (offset + length > data.byteLength) return undefined
  let value = keepMarker ? first : first & (0xff >> length)
  let unknown = value === 0xff >> length
  for (let index = 1; index < length; index += 1) {
    value = value * 256 + data[offset + index]
    unknown &&= data[offset + index] === 0xff
  }
  return { value, length, unknown: !keepMarker && unknown }
}

export function readUint(data: Uint8Array, element: Element): number {
  let value = 0
  for (let index = element.dataStart; index < element.end; index += 1)
    value = value * 256 + data[index]
  return value
}

export function readString(data: Uint8Array, element: Element): string {
  return new TextDecoder().decode(data.subarray(element.dataStart, element.end)).replace(/\0+$/, "")
}

export async function readRange(url: string, start: number, end: number): Promise<Uint8Array> {
  const controller = new AbortController()
  const response = await fetch(url, {
    headers: { Range: `bytes=${start}-${end - 1}` },
    signal: controller.signal,
  })
  if (response.status !== 206) {
    // A server that ignores Range would send the whole file.
    controller.abort()
    throw new Error(`Range request returned HTTP ${response.status}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}
