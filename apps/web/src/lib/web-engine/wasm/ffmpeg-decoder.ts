import type { VideoSamplePixelFormat } from "mediabunny"

/** Which WebAssembly module a decoder needs. Audio is DTS, TrueHD, and MLP; video is HEVC. */
export type FFmpegModuleKind = "audio" | "video"

export interface PacketInput {
  data: Uint8Array
  /** Seconds. */
  timestamp: number
  /** Seconds. */
  duration: number
}

export interface DecodedAudio {
  /** Seconds, or null when the stream carries no timestamp. */
  timestamp: number | null
  sampleRate: number
  /** One plane per channel, in WAVE speaker order. */
  channels: Float32Array<ArrayBuffer>[]
}

export interface DecodedVideo {
  /** Seconds. */
  timestamp: number
  /** Seconds. */
  duration: number
  format: VideoSamplePixelFormat
  width: number
  height: number
  /** Tightly packed planes, the default WebCodecs layout for the format. */
  data: Uint8Array<ArrayBuffer>
  /**
   * WebCodecs color space names. Typed as strings because TypeScript's DOM library
   * does not list the BT.2020, PQ, and HLG values yet.
   */
  colorSpace: {
    primaries: string | null
    transfer: string | null
    matrix: string | null
    fullRange: boolean
  }
  /** Reshaping and color metadata from the frame's Dolby Vision RPU, see dolby-vision.ts. */
  dolbyVision?: Float32Array<ArrayBuffer>
}

export interface DecodedOutput {
  audio: DecodedAudio[]
  video: DecodedVideo[]
}

export type DecoderRequest =
  | { type: "open"; kind: FFmpegModuleKind; codec: string; extradata?: Uint8Array }
  | { type: "decode"; packets: PacketInput[] }
  | { type: "drain" }
  | { type: "reset" }

export type DecoderResponse =
  | { type: "output"; output: DecodedOutput }
  | { type: "error"; message: string }

/** Released decoders by kind, codec, and extradata, so a seek reuses a warm worker. */
const idle = new Map<string, FFmpegDecoder>()

/**
 * Runs one FFmpeg decoder in a worker, so software decoding never blocks the
 * page. Requests are answered in order, each with the frames it produced.
 */
export class FFmpegDecoder {
  readonly #worker = new Worker(new URL("./ffmpeg.worker.ts", import.meta.url), {
    type: "module",
  })
  readonly #pending: {
    resolve: (output: DecodedOutput) => void
    reject: (error: Error) => void
  }[] = []
  #closed = false
  #key = ""

  private constructor() {
    this.#worker.onmessage = (event: MessageEvent<DecoderResponse>) => {
      const pending = this.#pending.shift()
      if (event.data.type === "output") pending?.resolve(event.data.output)
      else pending?.reject(new Error(event.data.message))
    }
    this.#worker.onerror = (event) =>
      this.#failAll(new Error(event.message || "Decoder worker failed"))
  }

  /** Opens `codec` (an FFmpeg decoder name), reusing a released decoder with the same setup. */
  static async open(
    kind: FFmpegModuleKind,
    codec: string,
    extradata?: Uint8Array,
  ): Promise<FFmpegDecoder> {
    const key = `${kind}:${codec}:${extradata?.join(",") ?? ""}`
    const released = idle.get(key)
    if (released) {
      idle.delete(key)
      return released
    }
    const decoder = new FFmpegDecoder()
    decoder.#key = key
    try {
      await decoder.#request({ type: "open", kind, codec, extradata: extradata?.slice() })
      return decoder
    } catch (error) {
      decoder.close()
      throw error
    }
  }

  decode(packets: PacketInput[]): Promise<DecodedOutput> {
    // Packet data often views a larger read cache, and cloning a view copies its whole buffer.
    const copies = packets.map((packet) => ({ ...packet, data: packet.data.slice() }))
    return this.#request(
      { type: "decode", packets: copies },
      copies.map((packet) => packet.data.buffer),
    )
  }

  /** Returns the frames still held for reordering. Call `reset` before decoding again. */
  drain(): Promise<DecodedOutput> {
    return this.#request({ type: "drain" })
  }

  /** Drops held frames so decoding can restart at a keyframe. */
  reset(): Promise<DecodedOutput> {
    return this.#request({ type: "reset" })
  }

  /** Keeps the worker for the next `open` with the same setup, replacing any decoder kept before. */
  release(): void {
    if (this.#closed) return
    idle.get(this.#key)?.close()
    idle.set(this.#key, this)
    void this.reset().catch(() => this.close())
  }

  /** Stops every released decoder's worker, once nothing will reopen them. */
  static closeIdle(): void {
    idle.forEach((decoder) => decoder.close())
    idle.clear()
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#worker.terminate()
    this.#failAll(new Error("Decoder closed"))
  }

  #request(request: DecoderRequest, transfer: Transferable[] = []): Promise<DecodedOutput> {
    if (this.#closed) return Promise.reject(new Error("Decoder closed"))
    return new Promise((resolve, reject) => {
      this.#pending.push({ resolve, reject })
      this.#worker.postMessage(request, transfer)
    })
  }

  #failAll(error: Error) {
    for (const pending of this.#pending.splice(0)) pending.reject(error)
  }
}
