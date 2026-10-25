import type { EncodedPacket, VideoSample } from "mediabunny"
import { describe, expect, it, vi } from "vitest"
import { EnhancementLayerDecoder, enhancementLayers } from "./dolby-vision-enhancement"
import type { DecodedVideo } from "./wasm/ffmpeg-decoder"

// The fake FFmpeg decoder holds one frame back, like a decoder reordering B-frames.
const decoded: Uint8Array[] = []
vi.mock("./wasm/ffmpeg-decoder", () => {
  let held: DecodedVideo | undefined
  const frame = (timestamp: number) => ({ timestamp }) as DecodedVideo
  return {
    FFmpegDecoder: {
      open: async () => ({
        decode: async ([packet]: { data: Uint8Array; timestamp: number }[]) => {
          decoded.push(packet.data)
          const out = held ? [held] : []
          held = frame(packet.timestamp)
          return { video: out, audio: [] }
        },
        drain: async () => {
          const out = held ? [held] : []
          held = undefined
          return { video: out, audio: [] }
        },
        reset: async () => ({ video: [], audio: [] }),
        release() {},
      }),
    },
  }
})

const slice = [0x02, 0x01, 0xaf]
const enhancementSlice = [63 << 1, 0x01, 0x02, 0x01, 0xd0]

function packet(seconds: number, ...nals: number[][]): EncodedPacket {
  const data = Uint8Array.from(nals.flatMap((nal) => [0, 0, 0, nal.length, ...nal]))
  return {
    data,
    timestamp: seconds,
    duration: 0.04,
    microsecondTimestamp: Math.round(seconds * 1e6),
  } as EncodedPacket
}

const sample = (seconds: number) =>
  ({ microsecondTimestamp: Math.round(seconds * 1e6), close() {} }) as VideoSample

describe("EnhancementLayerDecoder", () => {
  it("holds base layer samples until their enhancement layer frame decodes", async () => {
    const out: VideoSample[] = []
    const layers = new EnhancementLayerDecoder(4, (next) => out.push(next))
    const first = sample(0)
    const second = sample(0.04)

    await layers.decode(packet(0, slice, enhancementSlice))
    layers.push(first)
    expect(out).toEqual([])
    // The EL's NAL units reach FFmpeg unwrapped, as Annex B.
    expect(Array.from(decoded.at(-1)!)).toEqual([0, 0, 0, 1, 0x02, 0x01, 0xd0])

    await layers.decode(packet(0.04, slice, enhancementSlice))
    layers.push(second)
    expect(out).toEqual([first])
    expect(enhancementLayers.get(first)?.timestamp).toBe(0)

    await layers.flush()
    expect(out).toEqual([first, second])
    expect(enhancementLayers.get(second)?.timestamp).toBe(0.04)
  })

  it("passes samples of access units without an enhancement layer straight through", async () => {
    const out: VideoSample[] = []
    const layers = new EnhancementLayerDecoder(4, (next) => out.push(next))
    const only = sample(1)
    await layers.decode(packet(1, slice))
    layers.push(only)
    expect(out).toEqual([only])
    expect(enhancementLayers.has(only)).toBe(false)
  })
})
