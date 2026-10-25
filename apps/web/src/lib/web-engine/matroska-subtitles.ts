/**
 * Reads text subtitle tracks from a Matroska file over HTTP range requests.
 * Browsers expose none of them, and Mediabunny skips subtitle tracks. mkvmerge
 * indexes every subtitle block in the Cues element, with its offset inside the
 * cluster, so each cue costs one small request near the playhead instead of
 * reading the whole file.
 */

import {
  ID,
  MatroskaFile,
  elements,
  readRange,
  readUint,
  readVint,
  type MatroskaTrack,
} from "./matroska"

export type MatroskaSubtitleTrack = MatroskaTrack

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

const SUBTITLE_TRACK_TYPE = 17
const TEXT_CODECS = new Set(["S_TEXT/UTF8", "S_TEXT/ASS", "S_TEXT/SSA", "S_TEXT/WEBVTT"])
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
    const file = await MatroskaFile.open(url)
    if (!file) return undefined
    const tracks = (await file.tracks()).filter(
      (track) => track.type === SUBTITLE_TRACK_TYPE && TEXT_CODECS.has(track.codec),
    )
    if (!tracks.length) return undefined
    const secondsPerTick = await file.secondsPerTick()
    const cues = await file.load(ID.cues)
    if (!cues) return undefined
    const blocks = parseCues(
      cues.data,
      cues.element.dataStart,
      new Set(tracks.map((track) => track.number)),
      secondsPerTick,
    )
    const indexed = tracks.filter((track) => blocks.get(track.number)?.length)
    return indexed.length
      ? new MatroskaSubtitles(url, file.segmentStart, secondsPerTick, indexed, blocks)
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
