/**
 * Reads text subtitle tracks from a Matroska file over HTTP range requests.
 * Browsers expose none of them, and Mediabunny skips subtitle tracks. mkvmerge
 * indexes every subtitle block in the Cues element, with its offset inside the
 * cluster, so each cue costs one small request near the playhead instead of
 * reading the whole file.
 */

export interface MatroskaSubtitleTrack {
  number: number
  codec: string
  language: string
  name: string
  default: boolean
  forced: boolean
}

export interface SubtitleCue {
  start: number
  end: number
  text: string
}

interface IndexedBlock {
  time: number
  duration: number
  cluster: number
  relative: number
}

const ID = {
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
  language: 0x22b59c,
  languageBcp47: 0x22b59d,
  name: 0x536e,
  flagDefault: 0x88,
  flagForced: 0x55aa,
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

const SUBTITLE_TRACK_TYPE = 17
const TEXT_CODECS = new Set(["S_TEXT/UTF8", "S_TEXT/ASS", "S_TEXT/SSA", "S_TEXT/WEBVTT"])
const HEADER_BYTES = 256 * 1024
/** Bytes read per subtitle block; text blocks are a few hundred bytes. */
const BLOCK_BYTES = 4096

/** The text subtitle tracks of a Matroska file and their cues, loaded on demand. */
export class MatroskaSubtitles {
  readonly tracks: readonly MatroskaSubtitleTrack[]
  readonly #url: string
  readonly #segmentStart: number
  readonly #secondsPerTick: number
  readonly #blocks: ReadonlyMap<number, IndexedBlock[]>
  readonly #loaded = new Set<IndexedBlock>()
  readonly #clusterDataStarts = new Map<number, Promise<number>>()

  private constructor(
    url: string,
    segmentStart: number,
    secondsPerTick: number,
    tracks: MatroskaSubtitleTrack[],
    blocks: Map<number, IndexedBlock[]>,
  ) {
    this.#url = url
    this.#segmentStart = segmentStart
    this.#secondsPerTick = secondsPerTick
    this.tracks = tracks
    this.#blocks = blocks
  }

  /**
   * Reads the tracks and cue index. Resolves undefined when the file has no
   * text subtitles or does not index them.
   */
  static async open(url: string): Promise<MatroskaSubtitles | undefined> {
    const head = await readRange(url, 0, HEADER_BYTES)
    const segment = findElement(head, 0, head.byteLength, ID.segment)
    if (!segment) return undefined
    const segmentStart = segment.dataStart
    const children = (start: number) => elements(head, start, head.byteLength)

    // Top-level elements in the header, plus where the seek head says the rest live.
    const positions = new Map<number, number>()
    for (const element of children(segmentStart)) {
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
        if (id && !positions.has(id)) positions.set(id, segmentStart + position)
      }
    }

    const load = async (id: number) => {
      const position = positions.get(id)
      if (position === undefined) return undefined
      const header = await readRange(url, position, position + 16)
      const [element] = elements(header, 0, header.byteLength)
      if (!element || element.id !== id) return undefined
      const data = await readRange(url, position, position + element.declaredEnd)
      return { data, element: { ...element, end: data.byteLength } }
    }

    const tracksElement = await load(ID.tracks)
    if (!tracksElement) return undefined
    const tracks = parseTracks(tracksElement.data, tracksElement.element.dataStart)
    if (!tracks.length) return undefined
    const info = await load(ID.info)
    const secondsPerTick = (info ? timestampScale(info.data, info.element.dataStart) : 1e6) / 1e9
    const cues = await load(ID.cues)
    if (!cues) return undefined
    const blocks = parseCues(
      cues.data,
      cues.element.dataStart,
      new Set(tracks.map((track) => track.number)),
      secondsPerTick,
    )
    const indexed = tracks.filter((track) => blocks.get(track.number)?.length)
    return indexed.length
      ? new MatroskaSubtitles(url, segmentStart, secondsPerTick, indexed, blocks)
      : undefined
  }

  /** Fetches the cues of a track that start between `from` and `to` seconds, skipping ones loaded before. */
  async load(track: MatroskaSubtitleTrack, from: number, to: number): Promise<SubtitleCue[]> {
    const due = (this.#blocks.get(track.number) ?? []).filter(
      (block) =>
        block.time + block.duration >= from && block.time <= to && !this.#loaded.has(block),
    )
    due.forEach((block) => this.#loaded.add(block))
    const cues = await Promise.all(
      due.map(async (block) => {
        try {
          return await this.#readCue(track, block)
        } catch {
          this.#loaded.delete(block)
          return undefined
        }
      }),
    )
    return cues.filter((cue): cue is SubtitleCue => cue !== undefined)
  }

  async #readCue(track: MatroskaSubtitleTrack, block: IndexedBlock) {
    const dataStart = await this.#clusterDataStart(block.cluster)
    const start = dataStart + block.relative
    const bytes = await readRange(this.#url, start, start + BLOCK_BYTES)
    const [element] = elements(bytes, 0, bytes.byteLength)
    if (!element) return undefined
    let payload: Uint8Array | undefined
    let duration = block.duration
    if (element.id === ID.simpleBlock) payload = bytes.subarray(element.dataStart, element.end)
    if (element.id === ID.blockGroup) {
      for (const child of elements(bytes, element.dataStart, element.end)) {
        if (child.id === ID.block) payload = bytes.subarray(child.dataStart, child.end)
        if (child.id === ID.blockDuration && !block.duration) {
          duration = readUint(bytes, child) * this.#secondsPerTick
        }
      }
    }
    if (!payload) return undefined
    // Block header: track number (EBML varint), 16-bit relative timestamp, flags.
    const trackNumber = readVint(payload, 0)
    if (!trackNumber) return undefined
    const text = cueText(
      track.codec,
      new TextDecoder().decode(payload.subarray(trackNumber.length + 3)),
    )
    return text ? { start: block.time, end: block.time + (duration || 4), text } : undefined
  }

  #clusterDataStart(cluster: number): Promise<number> {
    let start = this.#clusterDataStarts.get(cluster)
    if (!start) {
      const position = this.#segmentStart + cluster
      start = readRange(this.#url, position, position + 16).then((header) => {
        const [element] = elements(header, 0, header.byteLength)
        if (!element) throw new Error("Matroska cluster header is unreadable")
        return position + element.dataStart
      })
      this.#clusterDataStarts.set(cluster, start)
    }
    return start
  }
}

/** Converts a block's payload to WebVTT cue text, keeping only the formatting VTT supports. */
export function cueText(codec: string, payload: string): string {
  if (codec === "S_TEXT/ASS" || codec === "S_TEXT/SSA") {
    // ReadOrder, Layer, Style, Name, MarginL, MarginR, MarginV, Effect, Text
    const text = payload.split(",").slice(8).join(",")
    return text
      .replace(/\{\\i1\}/g, "<i>")
      .replace(/\{\\i0?\}/g, "</i>")
      .replace(/\{[^}]*\}/g, "")
      .replace(/\\[Nn]/g, "\n")
      .replace(/\\h/g, " ")
      .trim()
  }
  return payload.replace(/\r\n?/g, "\n").trim()
}

function parseTracks(data: Uint8Array, start: number): MatroskaSubtitleTrack[] {
  const tracks: MatroskaSubtitleTrack[] = []
  for (const entry of elements(data, start, data.byteLength)) {
    if (entry.id !== ID.trackEntry) continue
    const track = {
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
      if (field.id === ID.language) track.language = readString(data, field)
      if (field.id === ID.languageBcp47) bcp47 = readString(data, field)
      if (field.id === ID.name) track.name = readString(data, field)
      if (field.id === ID.flagDefault) track.default = readUint(data, field) === 1
      if (field.id === ID.flagForced) track.forced = readUint(data, field) === 1
    }
    if (track.type !== SUBTITLE_TRACK_TYPE || !TEXT_CODECS.has(track.codec)) continue
    tracks.push({
      number: track.number,
      codec: track.codec,
      language: bcp47 || track.language,
      name: track.name,
      default: track.default,
      forced: track.forced,
    })
  }
  return tracks
}

function timestampScale(data: Uint8Array, start: number): number {
  for (const field of elements(data, start, data.byteLength)) {
    if (field.id === ID.timestampScale) return readUint(data, field)
  }
  return 1e6
}

function parseCues(
  data: Uint8Array,
  start: number,
  trackNumbers: Set<number>,
  secondsPerTick: number,
): Map<number, IndexedBlock[]> {
  const blocks = new Map<number, IndexedBlock[]>()
  for (const point of elements(data, start, data.byteLength)) {
    if (point.id !== ID.cuePoint) continue
    let time = 0
    for (const field of elements(data, point.dataStart, point.end)) {
      if (field.id === ID.cueTime) time = readUint(data, field) * secondsPerTick
      if (field.id !== ID.cueTrackPositions) continue
      let track = 0
      let cluster = -1
      let relative = -1
      let duration = 0
      for (const position of elements(data, field.dataStart, field.end)) {
        if (position.id === ID.cueTrack) track = readUint(data, position)
        if (position.id === ID.cueClusterPosition) cluster = readUint(data, position)
        if (position.id === ID.cueRelativePosition) relative = readUint(data, position)
        if (position.id === ID.cueDuration) duration = readUint(data, position) * secondsPerTick
      }
      if (!trackNumbers.has(track) || cluster < 0 || relative < 0) continue
      const list = blocks.get(track) ?? []
      list.push({ time, duration, cluster, relative })
      blocks.set(track, list)
    }
  }
  return blocks
}

interface Element {
  id: number
  start: number
  dataStart: number
  /** End of the element's data, clipped to the bytes read. */
  end: number
  /** End of the element's data in the file, past the bytes read when it is truncated. */
  declaredEnd: number
}

/** The EBML elements laid end to end in `[start, end)`, stopping at a truncated one. */
function elements(data: Uint8Array, start: number, end: number): Element[] {
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

function findElement(data: Uint8Array, start: number, end: number, id: number) {
  return elements(data, start, end).find((element) => element.id === id)
}

/** An EBML variable-length integer; IDs keep their length marker bit. */
function readVint(data: Uint8Array, offset: number, keepMarker = false) {
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

function readUint(data: Uint8Array, element: Element): number {
  let value = 0
  for (let index = element.dataStart; index < element.end; index += 1)
    value = value * 256 + data[index]
  return value
}

function readString(data: Uint8Array, element: Element): string {
  return new TextDecoder().decode(data.subarray(element.dataStart, element.end)).replace(/\0+$/, "")
}

async function readRange(url: string, start: number, end: number): Promise<Uint8Array> {
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

/** Seconds of cues kept loaded ahead of the playhead while a track shows. */
const LOAD_AHEAD_SECONDS = 30

/**
 * Adds each track to the video as an empty `<track>`, so the player lists it
 * like an embedded track, and loads cues around the playhead while it shows.
 * Returns a function that removes the tracks.
 */
export function attachMatroskaSubtitles(
  subtitles: MatroskaSubtitles,
  video: HTMLVideoElement,
  options: {
    currentTime: () => number
    /** The cue line in percent from the top, for cues added while a track shows. */
    linePosition: () => number
  },
): () => void {
  const empty = URL.createObjectURL(new Blob(["WEBVTT\n\n"], { type: "text/vtt" }))
  const loading = new Set<MatroskaSubtitleTrack>()
  const elements = subtitles.tracks.map((track) => {
    const element = document.createElement("track")
    element.kind = "subtitles"
    element.label = [track.name, track.forced ? "Forced" : ""].filter(Boolean).join(" · ")
    element.srclang = track.language
    element.src = empty
    video.append(element)
    return { track, element }
  })
  const timer = window.setInterval(() => {
    const time = options.currentTime()
    for (const { track, element } of elements) {
      if (element.track.mode === "disabled" || loading.has(track)) continue
      loading.add(track)
      void subtitles
        .load(track, time - 2, time + LOAD_AHEAD_SECONDS)
        .then((cues) => {
          for (const { start, end, text } of cues) {
            const cue = new VTTCue(start, end, text)
            cue.snapToLines = false
            cue.line = options.linePosition()
            element.track.addCue(cue)
          }
        })
        .finally(() => loading.delete(track))
    }
  }, 1000)
  return () => {
    window.clearInterval(timer)
    elements.forEach(({ element }) => element.remove())
    URL.revokeObjectURL(empty)
  }
}
