import audioWasm from "./ffmpeg-audio.wasm?url"
import videoWasm from "./ffmpeg-video.wasm?url"
import type {
  DecodedAudio,
  DecodedOutput,
  DecodedVideo,
  DecoderRequest,
  DecoderResponse,
  FFmpegModuleKind,
} from "./ffmpeg-decoder"
import { DOLBY_VISION_FLOATS } from "../dolby-vision"
import type { FFmpegModule } from "./ffmpeg-module"
import type { VideoSamplePixelFormat } from "mediabunny"

const MODULES: Record<FFmpegModuleKind, () => Promise<FFmpegModule>> = {
  audio: async () => (await import("./ffmpeg-audio.mjs")).default({ locateFile: () => audioWasm }),
  video: async () => (await import("./ffmpeg-video.mjs")).default({ locateFile: () => videoWasm }),
}

let module: FFmpegModule | undefined
let decoder = 0
// Requests run one at a time, in order, even while the module loads.
let queue = Promise.resolve()

self.onmessage = (event: MessageEvent<DecoderRequest>) => {
  queue = queue.then(async () => {
    try {
      reply({ type: "output", output: await handle(event.data) })
    } catch (error) {
      reply({ type: "error", message: error instanceof Error ? error.message : String(error) })
    }
  })
}

function reply(response: DecoderResponse) {
  const transfer =
    response.type === "output"
      ? [
          ...response.output.audio.flatMap((audio) => audio.channels.map((plane) => plane.buffer)),
          ...response.output.video.flatMap((video) => [
            video.data.buffer,
            ...(video.dolbyVision ? [video.dolbyVision.buffer] : []),
          ]),
        ]
      : []
  self.postMessage(response, { transfer })
}

async function handle(request: DecoderRequest): Promise<DecodedOutput> {
  if (request.type === "open") {
    module = await MODULES[request.kind]()
    const name = module.stringToNewUTF8(request.codec)
    const extradata = request.extradata ?? new Uint8Array()
    const pointer = extradata.byteLength ? module._malloc(extradata.byteLength) : 0
    module.HEAPU8.set(extradata, pointer)
    decoder = module._decoder_open(name, pointer, extradata.byteLength)
    module._free(name)
    if (pointer) module._free(pointer)
    if (!decoder) throw new Error(`FFmpeg could not open the ${request.codec} decoder`)
    return { audio: [], video: [] }
  }
  if (!module || !decoder) throw new Error("Decoder is not open")
  const output: DecodedOutput = { audio: [], video: [] }
  if (request.type === "reset") {
    module._decoder_reset(decoder)
    return output
  }
  if (request.type === "drain") {
    check(module._decoder_drain(decoder))
    receive(module, output)
    return output
  }
  for (const packet of request.packets) {
    const pointer = module._decoder_packet(decoder, packet.data.byteLength)
    if (!pointer) throw new Error("FFmpeg could not allocate a packet")
    module.HEAPU8.set(packet.data, pointer)
    check(module._decoder_send(decoder, packet.timestamp * 1e6, packet.duration * 1e6))
    receive(module, output)
  }
  return output
}

function check(result: number) {
  if (result < 0) throw new Error(`FFmpeg decoding failed (${result})`)
}

function receive(ffmpeg: FFmpegModule, output: DecodedOutput) {
  for (;;) {
    const result = ffmpeg._decoder_receive(decoder)
    check(result)
    if (result === 0) return
    if (ffmpeg._frame_samples(decoder) > 0) output.audio.push(readAudio(ffmpeg))
    else {
      const video = readVideo(ffmpeg)
      if (video) output.video.push(video)
    }
  }
}

// Views and scales for FFmpeg's packed sample formats (U8, S16, S32, FLT, DBL), indexed by
// av_get_packed_sample_fmt.
const SAMPLE_TYPES = [
  { view: Uint8Array, bias: 128, scale: 1 / 128 },
  { view: Int16Array, bias: 0, scale: 1 / 32768 },
  { view: Int32Array, bias: 0, scale: 1 / 2147483648 },
  { view: Float32Array, bias: 0, scale: 1 },
  { view: Float64Array, bias: 0, scale: 1 },
] as const

function readAudio(ffmpeg: FFmpegModule): DecodedAudio {
  const samples = ffmpeg._frame_samples(decoder)
  const channelCount = ffmpeg._frame_channels(decoder)
  const layout = ffmpeg._frame_sample_layout(decoder)
  const planar = layout >> 8 === 1
  const { view, bias, scale } = SAMPLE_TYPES[layout & 0xff] ?? SAMPLE_TYPES[3]
  const stride = planar ? 1 : channelCount
  const channels = Array.from({ length: channelCount }, (_, channel) => {
    const source = new view(
      ffmpeg.HEAPU8.buffer,
      ffmpeg._frame_data(decoder, planar ? channel : 0),
      samples * stride,
    )
    const offset = planar ? 0 : channel
    const plane = new Float32Array(samples)
    for (let sample = 0; sample < samples; sample += 1) {
      plane[sample] = (source[sample * stride + offset] - bias) * scale
    }
    return plane
  })
  const timestamp = ffmpeg._frame_timestamp(decoder)
  return {
    timestamp: timestamp < 0 ? null : timestamp / 1e6,
    sampleRate: ffmpeg._frame_sample_rate(decoder),
    channels,
  }
}

const VIDEO_FORMATS = new Map<string, VideoSamplePixelFormat>([
  ["8:1:1", "I420"],
  ["10:1:1", "I420P10"],
  ["12:1:1", "I420P12"],
  ["8:1:0", "I422"],
  ["10:1:0", "I422P10"],
  ["12:1:0", "I422P12"],
  ["8:0:0", "I444"],
  ["10:0:0", "I444P10"],
  ["12:0:0", "I444P12"],
])

function readVideo(ffmpeg: FFmpegModule): DecodedVideo | undefined {
  const layout = ffmpeg._frame_pixel_layout(decoder)
  const depth = layout >> 8
  const shiftX = (layout >> 4) & 0xf
  const shiftY = layout & 0xf
  const format = VIDEO_FORMATS.get(`${depth}:${shiftX}:${shiftY}`)
  if (!format) return undefined
  const width = ffmpeg._frame_width(decoder)
  const height = ffmpeg._frame_height(decoder)
  const dolbyVision = ffmpeg._frame_dovi(decoder)
  const bytes = depth > 8 ? 2 : 1
  const planes = [
    [width, height],
    [(width + (1 << shiftX) - 1) >> shiftX, (height + (1 << shiftY) - 1) >> shiftY],
  ] as const
  const sizes = [planes[0], planes[1], planes[1]]
  const data = new Uint8Array(sizes.reduce((total, [w, h]) => total + w * h * bytes, 0))
  let offset = 0
  sizes.forEach(([planeWidth, planeHeight], plane) => {
    const source = ffmpeg._frame_data(decoder, plane)
    const linesize = ffmpeg._frame_linesize(decoder, plane)
    const rowBytes = planeWidth * bytes
    for (let row = 0; row < planeHeight; row += 1) {
      const start = source + row * linesize
      data.set(ffmpeg.HEAPU8.subarray(start, start + rowBytes), offset)
      offset += rowBytes
    }
  })
  return {
    timestamp: ffmpeg._frame_timestamp(decoder) / 1e6,
    duration: ffmpeg._frame_duration(decoder) / 1e6,
    format,
    width,
    height,
    data,
    colorSpace: {
      primaries: PRIMARIES.get(ffmpeg._frame_color_primaries(decoder)) ?? null,
      transfer: TRANSFERS.get(ffmpeg._frame_color_transfer(decoder)) ?? null,
      matrix: MATRICES.get(ffmpeg._frame_color_matrix(decoder)) ?? null,
      fullRange: ffmpeg._frame_full_range(decoder) === 1,
    },
    dolbyVision: dolbyVision
      ? new Float32Array(ffmpeg.HEAPU8.buffer, dolbyVision, DOLBY_VISION_FLOATS).slice()
      : undefined,
  }
}

// H.273 code points to WebCodecs color space names.
const PRIMARIES = new Map([
  [1, "bt709"],
  [5, "bt470bg"],
  [6, "smpte170m"],
  [9, "bt2020"],
  [12, "smpte432"],
])
const TRANSFERS = new Map([
  [1, "bt709"],
  [6, "smpte170m"],
  [8, "linear"],
  [13, "iec61966-2-1"],
  [14, "bt709"],
  [15, "bt709"],
  [16, "pq"],
  [18, "hlg"],
])
const MATRICES = new Map([
  [0, "rgb"],
  [1, "bt709"],
  [5, "bt470bg"],
  [6, "smpte170m"],
  [9, "bt2020-ncl"],
])
