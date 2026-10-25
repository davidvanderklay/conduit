import {
  CustomVideoDecoder,
  VideoSample,
  registerDecoder,
  type EncodedPacket,
  type VideoCodec,
} from "mediabunny"
import { dolbyVisionMetadata } from "./dolby-vision"
import { HdrPeakTracker, hdrPeaks } from "./hdr-metadata"
import { FFmpegDecoder } from "./wasm/ffmpeg-decoder"

const OBU_METADATA = 5
const METADATA_ITUT_T35 = 4
/** T.35 country code, provider code, and provider oriented code of Dolby Vision RPUs. */
const DOLBY_VISION = [0xb5, 0x00, 0x3b, 0x00, 0x00, 0x08, 0x00]
/** The same for HDR10+ (ST 2094-40), with its application identifier. */
const HDR10_PLUS = [0xb5, 0x00, 0x3c, 0x00, 0x01, 0x04]

function readLeb128(data: Uint8Array, offset: number): [value: number, next: number] {
  let value = 0
  let position = offset
  for (let shift = 0; position < data.byteLength && shift < 56; shift += 7) {
    const byte = data[position++]
    value += (byte & 0x7f) * 2 ** shift
    if (!(byte & 0x80)) break
  }
  return [value, position]
}

const startsWith = (data: Uint8Array, prefix: number[]) =>
  prefix.every((byte, index) => data[index] === byte)

/** Yields the ITU-T T.35 payloads, from the country code on, of an AV1 temporal unit's metadata OBUs. */
export function* t35Payloads(data: Uint8Array): Generator<Uint8Array> {
  let offset = 0
  while (offset < data.byteLength) {
    const header = data[offset]
    let position = offset + (header & 0x04 ? 2 : 1)
    let size = data.byteLength - position
    // Only the last OBU of a temporal unit may leave out its size.
    if (header & 0x02) [size, position] = readLeb128(data, position)
    const end = Math.min(position + size, data.byteLength)
    if (((header >> 3) & 0x0f) === OBU_METADATA) {
      const [type, start] = readLeb128(data, position)
      if (type === METADATA_ITUT_T35) yield data.subarray(start, end)
    }
    offset = end
  }
}

/** Returns whether an AV1 temporal unit carries a Dolby Vision RPU (profile 10). */
export function hasAv1DolbyVisionRpu(data: Uint8Array): boolean {
  for (const payload of t35Payloads(data)) {
    if (startsWith(payload, DOLBY_VISION)) return true
  }
  return false
}

/** AV1 codec strings whose metadata OBUs the engine reads while the browser decodes. */
const metadataAv1 = new Set<string>()

/**
 * Decodes AV1 with the browser's decoder and attaches what its metadata OBUs
 * carry, which the browser drops: Dolby Vision RPUs and HDR10+ scene peaks.
 * Asks for software decoding, whose frames the presenter can read exactly.
 */
class Av1MetadataDecoder extends CustomVideoDecoder {
  #decoder?: VideoDecoder
  /** Parses RPUs and HDR10+ payloads with FFmpeg in a worker. */
  #parser?: FFmpegDecoder
  readonly #peakTracker = new HdrPeakTracker()
  /** Metadata by packet timestamp, waiting for its frame. */
  readonly #metadata = new Map<number, { dolbyVision?: Float32Array<ArrayBuffer>; peak?: number }>()
  #closed = false

  static override supports(codec: VideoCodec, config: VideoDecoderConfig): boolean {
    return codec === "av1" && metadataAv1.has(config.codec)
  }

  async init() {
    this.#parser = await FFmpegDecoder.open("video", "hevc")
    this.#decoder = new VideoDecoder({
      output: (frame) => {
        const metadata = this.#metadata.get(frame.timestamp)
        this.#metadata.delete(frame.timestamp)
        if (this.#closed) {
          frame.close()
          return
        }
        const sample = new VideoSample(frame)
        if (metadata?.dolbyVision) dolbyVisionMetadata.set(sample, metadata.dolbyVision)
        if (metadata?.peak) hdrPeaks.set(sample, metadata.peak)
        this.onSample(sample)
      },
      error: (error) => this.onError(error),
    })
    this.#decoder.configure({ ...this.config, hardwareAcceleration: "prefer-software" })
  }

  async decode(packet: EncodedPacket) {
    const decoder = this.#decoder!
    const parser = this.#parser!
    let dolbyVision: Float32Array<ArrayBuffer> | undefined
    let peak: number | undefined
    for (const payload of t35Payloads(packet.data)) {
      if (startsWith(payload, DOLBY_VISION)) {
        dolbyVision = await parser.parseRpu(payload.subarray(DOLBY_VISION.length), true)
      } else if (startsWith(payload, HDR10_PLUS)) {
        peak = this.#peakTracker.update(await parser.parseHdrMetadata("t35", payload))
      }
    }
    peak ??= this.#peakTracker.update([0, 0, 0])
    this.#metadata.set(packet.microsecondTimestamp, { dolbyVision, peak })
    decoder.decode(
      new EncodedVideoChunk({
        type: packet.type,
        timestamp: packet.microsecondTimestamp,
        duration: packet.microsecondDuration,
        data: packet.data,
      }),
    )
    while (decoder.decodeQueueSize > 4) {
      await new Promise((resolve) => decoder.addEventListener("dequeue", resolve, { once: true }))
    }
  }

  async flush() {
    await this.#decoder!.flush()
  }

  close() {
    this.#closed = true
    this.#metadata.clear()
    this.#parser?.release()
    if (this.#decoder?.state !== "closed") this.#decoder?.close()
  }
}

/** Routes an AV1 track through the decoder that reads its metadata OBUs. */
export function enableAv1Metadata(config: VideoDecoderConfig): void {
  metadataAv1.add(config.codec)
  registerDecoder(Av1MetadataDecoder)
}
