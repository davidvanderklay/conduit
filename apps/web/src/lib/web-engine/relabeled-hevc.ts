import {
  CustomVideoDecoder,
  VideoSample,
  registerDecoder,
  type EncodedPacket,
  type VideoCodec,
} from "mediabunny"
import { dolbyVisionMetadata, findDolbyVisionRpu } from "./dolby-vision"
import { rewriteHvccColor, rewritePacketColor, type ColorRewrite } from "./hevc-color"
import { FFmpegDecoder } from "./wasm/ffmpeg-decoder"

export type HdrTransfer = "pq" | "hlg"

const HDR_TRANSFERS = new Map<string, HdrTransfer>([
  ["pq", "pq"],
  ["hlg", "hlg"],
])

/** Narrows a WebCodecs transfer name, which TypeScript's DOM types still lack PQ and HLG in. */
export function hdrTransfer(transfer: string | null | undefined): HdrTransfer | undefined {
  return transfer ? HDR_TRANSFERS.get(transfer) : undefined
}

/**
 * What a relabeled stream really holds: HDR10 or HLG, or Dolby Vision profile 5,
 * whose IPT samples the presenter recovers and reshapes with each frame's RPU.
 */
export type Relabeled = { kind: "hdr"; transfer: HdrTransfer } | { kind: "dolby-vision" }

/** How each relabeled sample must be drawn, read by the presenter. */
export const relabeledSamples = new WeakMap<VideoSample, Relabeled>()

// BT.709 primaries and the sRGB transfer turn the browser's conversion into the
// YCbCr matrix alone. HDR keeps its BT.2020 matrix, so frames arrive as PQ or HLG
// R'G'B'. Dolby Vision's IPT matches no standard matrix; BT.601 has the smallest
// chroma gains, so the fewest IPT values clip before the shader inverts it.
const RELABEL: Record<Relabeled["kind"], ColorRewrite> = {
  hdr: { primaries: 1, transfer: 13 },
  "dolby-vision": { primaries: 1, transfer: 13, matrix: 6 },
}

interface Relabeling {
  relabeled: Relabeled
  description: Uint8Array<ArrayBuffer>
  lengthSize: number
}

/** HEVC codec strings decoded by the browser with relabeled color. */
const relabelings = new Map<string, Relabeling>()

/**
 * Feeds the browser's hardware HEVC decoder a relabeled SPS, so its frames reach
 * WebGPU in a form the engine can tone map, or reshape for Dolby Vision, itself.
 * Hardware frames reach WebGPU at 8 bits per channel, so this path is only
 * used where software decoding cannot keep up.
 */
class RelabeledHevcDecoder extends CustomVideoDecoder {
  #decoder?: VideoDecoder
  #relabeling?: Relabeling
  #rpuParser?: FFmpegDecoder
  /** Parsed RPU metadata by packet timestamp, waiting for its frame. */
  readonly #rpus = new Map<number, Float32Array<ArrayBuffer>>()
  #closed = false

  static override supports(codec: VideoCodec, config: VideoDecoderConfig): boolean {
    return codec === "hevc" && relabelings.has(config.codec)
  }

  async init() {
    const relabeling = relabelings.get(this.config.codec)!
    this.#relabeling = relabeling
    if (relabeling.relabeled.kind === "dolby-vision") {
      this.#rpuParser = await FFmpegDecoder.open("video", "hevc")
    }
    this.#decoder = new VideoDecoder({
      output: (frame) => {
        const metadata = this.#rpus.get(frame.timestamp)
        this.#rpus.delete(frame.timestamp)
        if (this.#closed) {
          frame.close()
          return
        }
        const sample = new VideoSample(frame)
        relabeledSamples.set(sample, relabeling.relabeled)
        if (metadata) dolbyVisionMetadata.set(sample, metadata)
        this.onSample(sample)
      },
      error: (error) => this.onError(error),
    })
    this.#decoder.configure({ ...this.config, description: relabeling.description })
  }

  async decode(packet: EncodedPacket) {
    const decoder = this.#decoder!
    const { lengthSize, relabeled } = this.#relabeling!
    const rpu = this.#rpuParser && findDolbyVisionRpu(packet.data, lengthSize)
    const metadata = rpu && (await this.#rpuParser!.parseRpu(rpu))
    if (metadata) this.#rpus.set(packet.microsecondTimestamp, metadata)
    decoder.decode(
      new EncodedVideoChunk({
        type: packet.type,
        timestamp: packet.microsecondTimestamp,
        duration: packet.microsecondDuration,
        data: rewritePacketColor(packet.data, lengthSize, RELABEL[relabeled.kind]),
      }),
    )
    // A few chunks in flight keep the hardware busy without holding every decoded surface.
    while (decoder.decodeQueueSize > 4) {
      await new Promise((resolve) => decoder.addEventListener("dequeue", resolve, { once: true }))
    }
  }

  async flush() {
    await this.#decoder!.flush()
  }

  close() {
    this.#closed = true
    this.#rpus.clear()
    this.#rpuParser?.release()
    if (this.#decoder?.state !== "closed") this.#decoder?.close()
  }
}

/**
 * Routes an HEVC track through the relabeling decoder. Returns false when the
 * browser cannot decode it or its SPS has no VUI to relabel.
 */
export async function enableRelabeledHevc(
  config: VideoDecoderConfig,
  relabeled: Relabeled,
): Promise<boolean> {
  const { description } = config
  if (!description) return false
  const record = ArrayBuffer.isView(description)
    ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
    : new Uint8Array(description)
  const rewritten = rewriteHvccColor(record, RELABEL[relabeled.kind])
  if (!rewritten) return false
  const support = await VideoDecoder.isConfigSupported({ ...config, description: rewritten }).catch(
    () => undefined,
  )
  if (!support?.supported) return false
  relabelings.set(config.codec, {
    relabeled,
    description: Uint8Array.from(rewritten),
    lengthSize: (record[21] & 3) + 1,
  })
  registerDecoder(RelabeledHevcDecoder)
  return true
}
