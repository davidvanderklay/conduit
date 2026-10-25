/**
 * Reads text and PGS image subtitle tracks from a Matroska file over HTTP range requests.
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
  decompressBlock,
  type MatroskaTrack,
} from "./matroska"
import { PgsDecoder, type PgsComposition } from "./pgs"

export type MatroskaSubtitleTrack = MatroskaTrack

/** A PGS display set, shown from `start` until the next one (or for `duration` when set). */
export interface ImageEvent {
  start: number
  duration: number
  composition: PgsComposition
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

const SUBTITLE_TRACK_TYPE = 17
const TEXT_CODECS = new Set(["S_TEXT/UTF8", "S_TEXT/ASS", "S_TEXT/SSA", "S_TEXT/WEBVTT"])
const IMAGE_CODEC = "S_HDMV/PGS"
/** Bytes read per subtitle block; text blocks are a few hundred bytes. */
const BLOCK_BYTES = 4096

/** The text and image subtitle tracks of a Matroska file and their cues, loaded on demand. */
export class MatroskaSubtitles {
  readonly tracks: readonly MatroskaSubtitleTrack[]
  readonly #url: string
  readonly #segmentStart: number
  readonly #secondsPerTick: number
  readonly #blocks: ReadonlyMap<number, IndexedBlock[]>
  readonly #loaded = new Set<IndexedBlock>()
  readonly #clusterDataStarts = new Map<number, Promise<number>>()
  readonly #pgsDecoders = new Map<number, PgsDecoder>()

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
      (track) =>
        track.type === SUBTITLE_TRACK_TYPE &&
        (TEXT_CODECS.has(track.codec) || track.codec === IMAGE_CODEC),
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

  /** Fetches the text cues of a track that start between `from` and `to` seconds, skipping ones loaded before. */
  async load(track: MatroskaSubtitleTrack, from: number, to: number): Promise<SubtitleCue[]> {
    const blocks = await this.#loadBlocks(track, from, to)
    const cues = await Promise.all(
      blocks.map(async ({ time, duration, payload }) => {
        const bytes = await decompressBlock(payload, track.compression)
        const text = cueText(track.codec, new TextDecoder().decode(bytes))
        return text ? { start: time, end: time + (duration || 4), text } : undefined
      }),
    )
    return cues.filter((cue) => cue !== undefined)
  }

  /**
   * Fetches and decodes the PGS display sets of an image track between `from` and
   * `to` seconds. Each one shows until the next, or for its duration when set.
   */
  async loadImages(track: MatroskaSubtitleTrack, from: number, to: number): Promise<ImageEvent[]> {
    let decoder = this.#pgsDecoders.get(track.number)
    if (!decoder) {
      decoder = new PgsDecoder()
      this.#pgsDecoders.set(track.number, decoder)
    }
    const events: ImageEvent[] = []
    for (const { time, duration, payload } of await this.#loadBlocks(track, from, to)) {
      const composition = decoder.decode(await decompressBlock(payload, track.compression))
      if (composition) events.push({ start: time, duration, composition })
    }
    return events
  }

  /** Reads the due blocks of a track in time order, skipping ones loaded before. */
  async #loadBlocks(track: MatroskaSubtitleTrack, from: number, to: number) {
    const due = (this.#blocks.get(track.number) ?? []).filter(
      (block) =>
        block.time + block.duration >= from && block.time <= to && !this.#loaded.has(block),
    )
    due.forEach((block) => this.#loaded.add(block))
    const read = await Promise.all(
      due.map(async (block) => {
        try {
          return await this.#readBlock(block)
        } catch {
          this.#loaded.delete(block)
          return undefined
        }
      }),
    )
    return read.filter((block) => block !== undefined)
  }

  async #readBlock(block: IndexedBlock) {
    const dataStart = await this.#clusterDataStart(block.cluster)
    const start = dataStart + block.relative
    let bytes = await readRange(this.#url, start, start + BLOCK_BYTES)
    let [element] = elements(bytes, 0, bytes.byteLength)
    // Image subtitles outgrow the first read; fetch the whole block.
    if (element && element.declaredEnd > bytes.byteLength) {
      bytes = await readRange(this.#url, start, start + element.declaredEnd)
      ;[element] = elements(bytes, 0, bytes.byteLength)
    }
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
    return { time: block.time, duration, payload: payload.subarray(trackNumber.length + 3) }
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
 * Adds each track to the video as an empty `<track>`, so the player lists and
 * selects it like an embedded track, and loads cues around the playhead while
 * it shows. Text cues go into the track; PGS images draw on `imageCanvas`, over
 * the displayed video. Returns a function that removes the tracks.
 */
export function attachMatroskaSubtitles(
  subtitles: MatroskaSubtitles,
  video: HTMLVideoElement,
  options: {
    currentTime: () => number
    /** The cue line in percent from the top, for cues added while a track shows. */
    linePosition: () => number
    /** A canvas covering the player, for image subtitles. */
    imageCanvas: HTMLCanvasElement
    /** The element showing the video, whose box and object-fit place image subtitles. */
    surface: () => HTMLElement
  },
): () => void {
  const empty = URL.createObjectURL(new Blob(["WEBVTT\n\n"], { type: "text/vtt" }))
  const loading = new Set<MatroskaSubtitleTrack>()
  const images = new Map<MatroskaSubtitleTrack, ImageEvent[]>()
  const entries = subtitles.tracks.map((track) => {
    const element = document.createElement("track")
    element.kind = "subtitles"
    element.label = [track.name, track.forced ? "Forced" : ""].filter(Boolean).join(" · ")
    element.srclang = track.language
    element.src = empty
    video.append(element)
    return { track, element }
  })

  const load = () => {
    const time = options.currentTime()
    for (const { track, element } of entries) {
      if (element.track.mode === "disabled" || loading.has(track)) continue
      loading.add(track)
      const from = time - 2
      const to = time + LOAD_AHEAD_SECONDS
      const loaded =
        track.codec === IMAGE_CODEC
          ? subtitles.loadImages(track, from, to).then((events) => {
              const all = [...(images.get(track) ?? []), ...events]
              images.set(
                track,
                all.sort((a, b) => a.start - b.start),
              )
            })
          : subtitles.load(track, from, to).then((cues) => {
              for (const { start, end, text } of cues) {
                const cue = new VTTCue(start, end, text)
                cue.snapToLines = false
                cue.line = options.linePosition()
                element.track.addCue(cue)
              }
            })
      void loaded.finally(() => loading.delete(track))
    }
  }

  let shown: ImageEvent | undefined
  const draw = () => {
    const showing = entries.find(
      ({ track, element }) => track.codec === IMAGE_CODEC && element.track.mode === "showing",
    )
    const time = options.currentTime()
    const events = (showing && images.get(showing.track)) ?? []
    const event = events.filter((candidate) => candidate.start <= time).at(-1)
    const current =
      event && (!event.duration || time < event.start + event.duration) ? event : undefined
    if (current === shown) return
    shown = current
    drawComposition(options.imageCanvas, options.surface(), current?.composition)
  }

  const loadTimer = window.setInterval(load, 1000)
  const drawTimer = window.setInterval(draw, 100)
  return () => {
    window.clearInterval(loadTimer)
    window.clearInterval(drawTimer)
    drawComposition(options.imageCanvas, options.surface(), undefined)
    entries.forEach(({ element }) => element.remove())
    URL.revokeObjectURL(empty)
  }
}

/** Draws a PGS composition where its frame sits inside the surface, honoring object-fit. */
function drawComposition(
  canvas: HTMLCanvasElement,
  surface: HTMLElement,
  composition: PgsComposition | undefined,
) {
  const scale = window.devicePixelRatio || 1
  canvas.width = Math.round(canvas.clientWidth * scale)
  canvas.height = Math.round(canvas.clientHeight * scale)
  const context = canvas.getContext("2d")
  if (!context || !composition?.objects.length) return
  const { videoWidth, videoHeight } = composition
  const box = surface.getBoundingClientRect()
  const canvasBox = canvas.getBoundingClientRect()
  const fit = getComputedStyle(surface).objectFit
  const contain = Math.min(box.width / videoWidth, box.height / videoHeight)
  const cover = Math.max(box.width / videoWidth, box.height / videoHeight)
  const scaleX = fit === "fill" ? box.width / videoWidth : fit === "cover" ? cover : contain
  const scaleY = fit === "fill" ? box.height / videoHeight : fit === "cover" ? cover : contain
  const left = box.left - canvasBox.left + (box.width - videoWidth * scaleX) / 2
  const top = box.top - canvasBox.top + (box.height - videoHeight * scaleY) / 2
  for (const { x, y, image } of composition.objects) {
    const bitmap = document.createElement("canvas")
    bitmap.width = image.width
    bitmap.height = image.height
    bitmap.getContext("2d")?.putImageData(image, 0, 0)
    context.drawImage(
      bitmap,
      (left + x * scaleX) * scale,
      (top + y * scaleY) * scale,
      image.width * scaleX * scale,
      image.height * scaleY * scale,
    )
  }
}
