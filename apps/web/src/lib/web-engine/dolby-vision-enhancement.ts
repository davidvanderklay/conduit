import type { EncodedPacket, VideoSample } from "mediabunny"
import { nalUnits } from "./hevc-color"
import { FFmpegDecoder, type DecodedVideo } from "./wasm/ffmpeg-decoder"

/** Enhancement layer frames of dual-layer Dolby Vision samples, read by the presenter. */
export const enhancementLayers = new WeakMap<VideoSample, DecodedVideo>()

const HEVC_NAL_UNSPEC63 = 63
/** Frames of the two layers match when their timestamps are this close, in microseconds. */
const PAIR_TOLERANCE = 500

/** Returns whether a length-prefixed HEVC access unit carries a Dolby Vision enhancement layer. */
export function hasEnhancementLayer(data: Uint8Array, lengthSize: number): boolean {
  for (const { type } of nalUnits(data, lengthSize)) {
    if (type === HEVC_NAL_UNSPEC63) return true
  }
  return false
}

/**
 * Decodes the enhancement layer of a single-track dual-layer Dolby Vision stream
 * (profile 7, as Blu-ray remuxes carry it) and pairs its frames with the base
 * layer's. The EL is a second HEVC stream whose NAL units each hide inside one
 * of type 63; FFmpeg decodes it in a worker at its own, usually quarter, size.
 *
 * Feed every access unit to `decode` in decode order, and every decoded base
 * layer sample to `push` in presentation order. Samples come out of `onSample`
 * in the same order, with their EL frame attached once it has decoded. Streams
 * without an EL pass straight through.
 */
export class EnhancementLayerDecoder {
  #decoder?: Promise<FFmpegDecoder>
  /** NAL length size of the stream's access units; undefined for Annex B streams, which carry no EL here. */
  readonly #lengthSize: number | undefined
  readonly #onSample: (sample: VideoSample) => void
  /** Decoded EL frames, in presentation order, waiting for their base layer sample. */
  readonly #frames: DecodedVideo[] = []
  /** Microsecond timestamps of access units with an EL whose sample has not come out yet. */
  #expected: number[] = []
  readonly #waiting: VideoSample[] = []
  /** Timestamp of the latest EL frame out of the decoder, in microseconds. */
  #latest = -Infinity
  #draining = false

  constructor(lengthSize: number | undefined, onSample: (sample: VideoSample) => void) {
    this.#lengthSize = lengthSize
    this.#onSample = onSample
  }

  async decode(packet: EncodedPacket): Promise<void> {
    if (!this.#lengthSize) return
    const units = [...nalUnits(packet.data, this.#lengthSize)].filter(
      ({ type }) => type === HEVC_NAL_UNSPEC63,
    )
    if (units.length === 0) return
    this.#expected.push(packet.microsecondTimestamp)
    // Unwrapped, the units form an Annex B stream with its own parameter sets.
    const data = new Uint8Array(units.reduce((total, { nal }) => total + nal.byteLength + 2, 0))
    let offset = 0
    for (const { nal } of units) {
      data.set([0, 0, 0, 1], offset)
      data.set(nal.subarray(2), offset + 4)
      offset += nal.byteLength + 2
    }
    this.#decoder ??= FFmpegDecoder.open("video", "hevc")
    const decoder = await this.#decoder
    this.#receive(
      (await decoder.decode([{ data, timestamp: packet.timestamp, duration: packet.duration }]))
        .video,
    )
  }

  push(sample: VideoSample) {
    this.#waiting.push(sample)
    this.#release()
  }

  /** Emits every waiting sample with the EL frames the decoder still held, then starts over. */
  async flush(): Promise<void> {
    if (this.#decoder) {
      const decoder = await this.#decoder
      this.#receive((await decoder.drain()).video)
      await decoder.reset()
    }
    this.#draining = true
    this.#release()
    this.#draining = false
    this.#frames.length = 0
    this.#expected = []
    this.#latest = -Infinity
  }

  close() {
    this.#waiting.forEach((sample) => sample.close())
    this.#waiting.length = 0
    this.#frames.length = 0
    void this.#decoder?.then((decoder) => decoder.release()).catch(() => undefined)
  }

  #receive(video: DecodedVideo[]) {
    for (const frame of video) {
      this.#frames.push(frame)
      this.#latest = Math.max(this.#latest, frame.timestamp * 1e6)
    }
    this.#release()
  }

  #release() {
    while (this.#waiting.length > 0) {
      const sample = this.#waiting[0]
      const timestamp = sample.microsecondTimestamp
      const index = this.#frames.findIndex(
        (frame) => Math.abs(frame.timestamp * 1e6 - timestamp) < PAIR_TOLERANCE,
      )
      const expected = this.#expected.some((time) => Math.abs(time - timestamp) < PAIR_TOLERANCE)
      // Wait while the sample's EL frame may still come out of the decoder.
      if (index < 0 && expected && !this.#draining && this.#latest < timestamp + PAIR_TOLERANCE) {
        return
      }
      if (index >= 0) {
        enhancementLayers.set(sample, this.#frames[index])
        this.#frames.splice(0, index + 1)
      }
      this.#expected = this.#expected.filter((time) => time > timestamp + PAIR_TOLERANCE)
      this.#waiting.shift()
      this.#onSample(sample)
    }
  }
}
