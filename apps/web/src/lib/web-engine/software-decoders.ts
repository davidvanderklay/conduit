import {
  CustomVideoDecoder,
  EncodedPacketSink,
  VideoSample,
  registerDecoder,
  type EncodedPacket,
  type InputAudioTrack,
  type VideoCodec,
} from "mediabunny"
import { dolbyVisionMetadata } from "./dolby-vision"
import { FFmpegDecoder, type DecodedOutput } from "./wasm/ffmpeg-decoder"

/** HEVC codec strings the browser cannot decode, which the WebAssembly decoder takes instead. */
const softwareHevc = new Set<string>()

/** Decodes HEVC Main and Main 10 with FFmpeg in a worker when the browser has no HEVC decoder. */
class SoftwareHevcDecoder extends CustomVideoDecoder {
  #decoder?: FFmpegDecoder
  #closed = false

  static override supports(codec: VideoCodec, config: VideoDecoderConfig): boolean {
    return codec === "hevc" && softwareHevc.has(config.codec)
  }

  async init() {
    const { description } = this.config
    this.#decoder = await FFmpegDecoder.open(
      "video",
      "hevc",
      description &&
        (ArrayBuffer.isView(description)
          ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
          : new Uint8Array(description)),
    )
  }

  async decode(packet: EncodedPacket) {
    this.#emit(await this.#decoder!.decode([packet]))
  }

  async flush() {
    this.#emit(await this.#decoder!.drain())
    await this.#decoder!.reset()
  }

  close() {
    this.#closed = true
    this.#decoder?.release()
  }

  #emit({ video }: DecodedOutput) {
    // Requests still in flight at close resolve after Mediabunny stopped listening.
    if (this.#closed) return
    for (const frame of video) {
      const sample = new VideoSample(frame.data, {
        format: frame.format,
        codedWidth: frame.width,
        codedHeight: frame.height,
        timestamp: frame.timestamp,
        duration: frame.duration,
        // The DOM types predate the BT.2020, PQ, and HLG names FFmpeg reports.
        colorSpace: frame.colorSpace as VideoColorSpaceInit,
      })
      if (frame.dolbyVision) dolbyVisionMetadata.set(sample, frame.dolbyVision)
      this.onSample(sample)
    }
  }
}

/**
 * Routes an HEVC track to the WebAssembly decoder when the browser cannot decode
 * it, or always with `force`, for Dolby Vision profile 5, whose reshaping needs
 * raw samples and the RPU metadata only FFmpeg returns.
 */
export async function enableSoftwareHevc(config: VideoDecoderConfig, force = false): Promise<void> {
  const native = force
    ? undefined
    : await VideoDecoder.isConfigSupported(config).catch(() => undefined)
  if (native?.supported) return
  softwareHevc.add(config.codec)
  registerDecoder(SoftwareHevcDecoder)
}

/** Decoding starts this far before a seek target, so TrueHD reaches a major sync first. */
const PREROLL_SECONDS = 0.5
/** Packets sent to the worker per round trip. */
const BATCH_SECONDS = 0.2

/** Decodes an audio track with FFmpeg in a worker and yields Web Audio buffers from `from` on. */
export async function* softwareAudioBuffers(
  track: InputAudioTrack,
  codec: string,
  from: number,
): AsyncGenerator<{ buffer: AudioBuffer; timestamp: number }> {
  const sink = new EncodedPacketSink(track)
  const start =
    (await sink.getPacket(Math.max(0, from - PREROLL_SECONDS))) ?? (await sink.getFirstPacket())
  if (!start) return
  const decoder = await FFmpegDecoder.open("audio", codec)
  let next = start.timestamp
  function* buffers({ audio }: DecodedOutput) {
    for (const chunk of audio) {
      const timestamp = chunk.timestamp ?? next
      const length = chunk.channels[0]?.length ?? 0
      next = timestamp + length / chunk.sampleRate
      if (!length || next <= from) continue
      const buffer = new AudioBuffer({
        numberOfChannels: chunk.channels.length,
        length,
        sampleRate: chunk.sampleRate,
      })
      chunk.channels.forEach((plane, channel) => buffer.copyToChannel(plane, channel))
      yield { buffer, timestamp }
    }
  }
  try {
    let batch: EncodedPacket[] = []
    for await (const packet of sink.packets(start)) {
      batch.push(packet)
      if (packet.timestamp + packet.duration - batch[0].timestamp < BATCH_SECONDS) continue
      yield* buffers(await decoder.decode(batch))
      batch = []
    }
    yield* buffers(await decoder.decode(batch))
    yield* buffers(await decoder.drain())
  } finally {
    decoder.release()
  }
}
