import type { VideoSample } from "mediabunny"
import { DOLBY_VISION_FLOATS, dolbyVisionMetadata, dolbyVisionPeak } from "./dolby-vision"
import { hdrPeaks } from "./hdr-metadata"
import { relabeledSamples, type HdrTransfer } from "./relabeled-hevc"
import {
  EXTERNAL_DOLBY_VISION_SHADER,
  EXTERNAL_HDR_SHADER,
  EXTERNAL_SHADER,
  PLANAR_SHADER,
} from "./shaders"

/** Draws decoded frames into the player's canvas at the frame's display size. */
export interface FramePresenter {
  readonly kind: "webgpu" | "canvas"
  /** Resolves once the sample's pixels have been read, so the caller may close it. */
  present(sample: VideoSample): Promise<void>
  destroy(): void
}

/** WebGPU when the browser exposes an adapter, otherwise Canvas 2D without tone mapping. */
export async function createPresenter(canvas: HTMLCanvasElement): Promise<FramePresenter> {
  const gpu = await createGpuPresenter(canvas).catch(() => undefined)
  if (gpu) return recoverable(canvas, gpu)
  const context = canvas.getContext("2d")
  if (!context) throw new Error("The browser could not create a video canvas.")
  return {
    kind: "canvas",
    async present(sample) {
      resizeCanvas(canvas, sample)
      sample.draw(context, 0, 0, canvas.width, canvas.height)
    },
    destroy() {},
  }
}

class GpuDeviceLostError extends Error {}

/** Rebuilds the WebGPU presenter on the same canvas once if the GPU device is lost, as after a driver reset. */
function recoverable(canvas: HTMLCanvasElement, initial: FramePresenter): FramePresenter {
  let current = initial
  let recovered = false
  return {
    kind: "webgpu",
    async present(sample) {
      try {
        await current.present(sample)
      } catch (error) {
        if (!(error instanceof GpuDeviceLostError) || recovered) throw error
        recovered = true
        current.destroy()
        current = (await createGpuPresenter(canvas)) ?? current
        if (current === initial) throw error
        await current.present(sample)
      }
    },
    destroy() {
      current.destroy()
    },
  }
}

async function createGpuPresenter(canvas: HTMLCanvasElement): Promise<FramePresenter | undefined> {
  const adapter = await navigator.gpu?.requestAdapter()
  if (!adapter) return undefined
  const device = await adapter.requestDevice()
  const context = canvas.getContext("webgpu")
  if (!context) {
    device.destroy()
    return undefined
  }
  const format = navigator.gpu.getPreferredCanvasFormat()
  context.configure({ device, format, alphaMode: "opaque" })
  let lost: string | undefined
  void device.lost.then((info) => {
    lost = info.message || info.reason
  })
  device.addEventListener("uncapturederror", (event) =>
    console.error("WebGPU:", event.error.message),
  )

  const pipeline = (code: string) => {
    const module = device.createShaderModule({ code })
    return device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vertexMain" },
      fragment: { module, entryPoint: "fragmentMain", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    })
  }
  const externalPipeline = pipeline(EXTERNAL_SHADER)
  const planarPipeline = pipeline(PLANAR_SHADER)
  const externalHdrPipeline = pipeline(EXTERNAL_HDR_SHADER)
  const externalDolbyVisionPipeline = pipeline(EXTERNAL_DOLBY_VISION_SHADER)
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" })
  const uniforms = device.createBuffer({
    size: 80,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  // Always bound, so non Dolby Vision frames can share the planar pipeline.
  const dolbyVision = device.createBuffer({
    size: Math.ceil((DOLBY_VISION_FLOATS * 4) / 16) * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  let planes: { key: string; textures: GPUTexture[] } | undefined
  // Some drivers (and SwiftShader) cannot import frames as external textures. Frames
  // in system memory then take the planar path instead.
  let importExternal = true
  let staging = new Uint8Array(0)

  const draw = (renderPipeline: GPURenderPipeline, entries: GPUBindGroupEntry[]) => {
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    })
    pass.setPipeline(renderPipeline)
    pass.setBindGroup(
      0,
      device.createBindGroup({ layout: renderPipeline.getBindGroupLayout(0), entries }),
    )
    pass.draw(3)
    pass.end()
    device.queue.submit([encoder.finish()])
  }

  /** Returns false when the browser cannot import the frame, so the caller can read it back instead. */
  const drawExternal = (sample: VideoSample): boolean => {
    if (!importExternal) return false
    const frame = sample.toVideoFrame()
    try {
      draw(externalPipeline, [
        { binding: 0, resource: sampler },
        { binding: 1, resource: device.importExternalTexture({ source: frame }) },
      ])
      return true
    } catch {
      importExternal = false
      return false
    } finally {
      frame.close()
    }
  }

  /** Draws a hardware frame whose color was relabeled, see relabeled-hevc.ts. */
  const drawRelabeled = (
    sample: VideoSample,
    renderPipeline: GPURenderPipeline,
    params: Float32Array,
    metadata?: Float32Array<ArrayBuffer>,
  ) => {
    const frame = sample.toVideoFrame()
    try {
      device.queue.writeBuffer(uniforms, 0, params)
      if (metadata) device.queue.writeBuffer(dolbyVision, 0, metadata)
      draw(renderPipeline, [
        { binding: 0, resource: { buffer: uniforms } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: device.importExternalTexture({ source: frame }) },
        ...(metadata ? [{ binding: 3, resource: { buffer: dolbyVision } }] : []),
      ])
    } finally {
      frame.close()
    }
  }

  const drawPlanar = async (sample: VideoSample, layout: PlanarLayout, params: Float32Array) => {
    const size = sample.allocationSize()
    if (staging.byteLength < size) staging = new Uint8Array(size)
    const planeLayouts = await sample.copyTo(staging)
    const { width, height } = sample.visibleRect
    const chromaWidth = Math.ceil(width / layout.chroma[0])
    const chromaHeight = Math.ceil(height / layout.chroma[1])
    const textureFormat: GPUTextureFormat = layout.bits > 8 ? "r16uint" : "r8uint"
    const key = `${width}x${height}:${sample.format}`
    if (planes?.key !== key) {
      planes?.textures.forEach((texture) => texture.destroy())
      planes = {
        key,
        textures: [
          [width, height],
          [chromaWidth, chromaHeight],
          [chromaWidth, chromaHeight],
        ].map(([planeWidth, planeHeight]) =>
          device.createTexture({
            size: [planeWidth, planeHeight],
            format: textureFormat,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
          }),
        ),
      }
    }
    planes.textures.forEach((texture, index) => {
      const plane = planeLayouts[index]
      device.queue.writeTexture(
        { texture },
        staging,
        { offset: plane.offset, bytesPerRow: plane.stride, rowsPerImage: texture.height },
        [texture.width, texture.height],
      )
    })
    device.queue.writeBuffer(uniforms, 0, params)
    const metadata = dolbyVisionMetadata.get(sample)
    if (metadata) device.queue.writeBuffer(dolbyVision, 0, metadata)
    draw(planarPipeline, [
      { binding: 0, resource: { buffer: uniforms } },
      ...planes.textures.map((texture, index) => ({
        binding: index + 1,
        resource: texture.createView(),
      })),
      { binding: 4, resource: { buffer: dolbyVision } },
    ])
  }

  return {
    kind: "webgpu",
    async present(sample) {
      if (lost !== undefined) throw new GpuDeviceLostError(`The GPU device was lost: ${lost}`)
      resizeCanvas(canvas, sample)
      const relabeled = relabeledSamples.get(sample)
      const metadata = dolbyVisionMetadata.get(sample)
      if (relabeled?.kind === "hdr") {
        const params = externalHdrParams(relabeled.transfer, hdrPeaks.get(sample))
        return drawRelabeled(sample, externalHdrPipeline, params)
      }
      if (relabeled && metadata) {
        const params = relabeledDolbyVisionParams(sample, metadata)
        return drawRelabeled(sample, externalDolbyVisionPipeline, params, metadata)
      }
      const layout = sample.format ? PLANAR_LAYOUTS.get(sample.format) : undefined
      if (layout && metadata) return drawPlanar(sample, layout, dolbyVisionParams(layout, metadata))
      const hdr = layout && planarParams(sample, layout, true, hdrPeaks.get(sample))
      if (layout && hdr) return drawPlanar(sample, layout, hdr)
      if (drawExternal(sample)) return
      const sdr = layout && planarParams(sample, layout, false)
      if (!layout || !sdr) throw new Error("The GPU could not draw this video frame.")
      await drawPlanar(sample, layout, sdr)
    },
    destroy() {
      planes?.textures.forEach((texture) => texture.destroy())
      uniforms.destroy()
      dolbyVision.destroy()
      context.unconfigure()
      device.destroy()
    },
  }
}

interface PlanarLayout {
  bits: number
  /** Horizontal and vertical chroma subsampling factors. */
  chroma: [number, number]
}

// Keyed by string because Mediabunny's bundled WebCodecs types predate the 10 and 12 bit
// formats and the BT.2020 enums that the DOM library and real frames use.
const PLANAR_LAYOUTS = new Map<string, PlanarLayout>([
  ["I420", { bits: 8, chroma: [2, 2] }],
  ["I420P10", { bits: 10, chroma: [2, 2] }],
  ["I420P12", { bits: 12, chroma: [2, 2] }],
  ["I422", { bits: 8, chroma: [2, 1] }],
  ["I422P10", { bits: 10, chroma: [2, 1] }],
  ["I422P12", { bits: 12, chroma: [2, 1] }],
  ["I444", { bits: 8, chroma: [1, 1] }],
  ["I444P10", { bits: 10, chroma: [1, 1] }],
  ["I444P12", { bits: 12, chroma: [1, 1] }],
])

const BT2020_LUMA: [kr: number, kb: number] = [0.2627, 0.0593]
const BT709_LUMA: [kr: number, kb: number] = [0.2126, 0.0722]
const LUMA_COEFFICIENTS = new Map<string, [kr: number, kb: number]>([
  ["bt2020-ncl", BT2020_LUMA],
  ["bt709", BT709_LUMA],
  ["bt470bg", [0.299, 0.114]],
  ["smpte170m", [0.299, 0.114]],
])

const HDR_TRANSFERS = new Map<string, number>([
  ["pq", 0],
  ["hlg", 1],
])
const SDR_TRANSFER = 2
const DOLBY_VISION_TRANSFER = 3

/** Assumed peak when the stream does not say; most HDR10 releases are mastered at 1000 nits. */
const DEFAULT_SOURCE_PEAK = 1000
/** BT.2408 reference white, drawn as SDR white. */
const SDR_WHITE = 203

/**
 * Planar shader parameters. With `hdr`, returns undefined unless the frame is
 * PQ or HLG; without it, returns SDR parameters unless the frame is HDR.
 */
function planarParams(
  sample: Pick<VideoSample, "colorSpace">,
  layout: PlanarLayout,
  hdr: boolean,
  peak = DEFAULT_SOURCE_PEAK,
): Float32Array | undefined {
  const { transfer, matrix, primaries, fullRange } = sample.colorSpace
  const hdrTransfer = transfer ? HDR_TRANSFERS.get(transfer) : undefined
  if (hdr !== (hdrTransfer !== undefined)) return undefined
  const transferId = hdrTransfer ?? SDR_TRANSFER
  const [kr, kb] = (matrix && LUMA_COEFFICIENTS.get(matrix)) || (hdr ? BT2020_LUMA : BT709_LUMA)
  const kg = 1 - kr - kb
  const scale = 2 ** (layout.bits - 8)
  const max = 2 ** layout.bits - 1
  const params = new Float32Array(20)
  params.set([1, 1, 1, 0], 0)
  params.set([0, (-2 * kb * (1 - kb)) / kg, 2 * (1 - kb), 0], 4)
  params.set([2 * (1 - kr), (-2 * kr * (1 - kr)) / kg, 0, 0], 8)
  params.set(fullRange ? [1 / max, 1 / max] : [1 / (219 * scale), 1 / (224 * scale)], 12)
  params.set(fullRange ? [0, 2 ** (layout.bits - 1)] : [16 * scale, 128 * scale], 14)
  const words = new Uint32Array(params.buffer)
  words[16] = transferId
  params[17] = peak
  params[18] = SDR_WHITE
  words[19] = hdr && primaries !== "bt709" ? 1 : 0
  return params
}

/** Shader parameters for a relabeled BT.2020 frame, whose external texture holds PQ or HLG R'G'B'. */
function externalHdrParams(transfer: HdrTransfer, peak = DEFAULT_SOURCE_PEAK): Float32Array {
  const params = new Float32Array(20)
  const words = new Uint32Array(params.buffer)
  words[16] = HDR_TRANSFERS.get(transfer)!
  params[17] = peak
  params[18] = SDR_WHITE
  words[19] = 1
  return params
}

/**
 * Shader parameters for a relabeled Dolby Vision frame: the inverse of the
 * BT.601 matrix the browser applied, and how it normalized the codes.
 */
function relabeledDolbyVisionParams(
  sample: Pick<VideoSample, "colorSpace">,
  metadata: Float32Array,
): Float32Array {
  const params = new Float32Array(20)
  const [kr, kb] = LUMA_COEFFICIENTS.get("smpte170m")!
  const kg = 1 - kr - kb
  // Columns of the RGB to Y'CbCr matrix.
  params.set([kr, -kr / (2 * (1 - kb)), 0.5, 0], 0)
  params.set([kg, -kg / (2 * (1 - kb)), -kg / (2 * (1 - kr)), 0], 4)
  params.set([kb, 0.5, -kb / (2 * (1 - kr)), 0], 8)
  const codeMax = 2 ** metadata[0] - 1
  const scale = 2 ** (metadata[0] - 8)
  const center = 128 * scale
  params.set(
    sample.colorSpace.fullRange
      ? [1, 1, 0, center / codeMax]
      : [
          (219 * scale) / codeMax,
          (224 * scale) / codeMax,
          (16 * scale) / codeMax,
          center / codeMax,
        ],
    12,
  )
  const words = new Uint32Array(params.buffer)
  words[16] = DOLBY_VISION_TRANSFER
  params[17] = dolbyVisionPeak(metadata)
  params[18] = SDR_WHITE
  words[19] = 1
  return params
}

/** Shader parameters for a Dolby Vision frame, whose samples the RPU interprets as full range codes. */
function dolbyVisionParams(layout: PlanarLayout, metadata: Float32Array): Float32Array {
  const params = new Float32Array(20)
  const scale = 1 / (2 ** layout.bits - 1)
  params.set([scale, scale], 12)
  const words = new Uint32Array(params.buffer)
  words[16] = DOLBY_VISION_TRANSFER
  params[17] = dolbyVisionPeak(metadata)
  params[18] = SDR_WHITE
  words[19] = 1
  return params
}

function resizeCanvas(canvas: HTMLCanvasElement, sample: VideoSample) {
  if (canvas.width !== sample.displayWidth) canvas.width = sample.displayWidth
  if (canvas.height !== sample.displayHeight) canvas.height = sample.displayHeight
}
