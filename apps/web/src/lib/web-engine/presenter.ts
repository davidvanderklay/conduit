import type { VideoSample } from "mediabunny"
import { DOLBY_VISION_FLOATS, dolbyVisionMetadata, dolbyVisionPeak } from "./dolby-vision"
import { EXTERNAL_SHADER, PLANAR_SHADER } from "./shaders"

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
  if (gpu) return gpu
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
      if (lost !== undefined) throw new Error(`The GPU device was lost: ${lost}`)
      resizeCanvas(canvas, sample)
      const layout = sample.format ? PLANAR_LAYOUTS.get(sample.format) : undefined
      const metadata = dolbyVisionMetadata.get(sample)
      if (layout && metadata) return drawPlanar(sample, layout, dolbyVisionParams(layout, metadata))
      const hdr = layout && planarParams(sample, layout, true)
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

/** Assumed peak when the container does not say; most HDR10 releases are mastered at 1000 nits. */
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
  params[17] = DEFAULT_SOURCE_PEAK
  params[18] = SDR_WHITE
  words[19] = hdr && primaries !== "bt709" ? 1 : 0
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
