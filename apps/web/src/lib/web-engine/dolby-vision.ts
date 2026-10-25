import type { VideoSample } from "mediabunny"

/**
 * Float count of the Dolby Vision metadata FFmpeg's decoder attaches to each
 * frame, in the layout `frame_dovi` in apps/web/wasm/ffmpeg_bridge.c writes.
 */
export const DOLBY_VISION_FLOATS = 32 + 3 * (1 + 9 + 8 * 27)

/** Dolby Vision metadata of software-decoded samples, read by the presenter. */
export const dolbyVisionMetadata = new WeakMap<VideoSample, Float32Array<ArrayBuffer>>()

const HEVC_NAL_UNSPEC62 = 62

/**
 * Returns the Dolby Vision RPU NAL unit of a length-prefixed HEVC access unit,
 * which Dolby Vision hides in NAL units of type 62.
 */
export function findDolbyVisionRpu(data: Uint8Array, lengthSize = 4): Uint8Array | undefined {
  let offset = 0
  while (offset + lengthSize < data.byteLength) {
    let length = 0
    for (let index = 0; index < lengthSize; index += 1) length = length * 256 + data[offset + index]
    const type = (data[offset + lengthSize] >> 1) & 0x3f
    if (type === HEVC_NAL_UNSPEC62) {
      return data.subarray(offset + lengthSize, offset + lengthSize + length)
    }
    offset += lengthSize + length
  }
  return undefined
}

/** The peak luminance in nits that a frame's metadata declares, for tone mapping. */
export function dolbyVisionPeak(metadata: Float32Array): number {
  const sceneMax = metadata[2]
  return pqToNits(sceneMax > 0 ? sceneMax : metadata[1])
}

function pqToNits(encoded: number): number {
  const m1 = 0.1593017578125
  const m2 = 78.84375
  const c1 = 0.8359375
  const c2 = 18.8515625
  const c3 = 18.6875
  const power = Math.pow(Math.max(encoded, 0), 1 / m2)
  return 10000 * Math.pow(Math.max(power - c1, 0) / (c2 - c3 * power), 1 / m1)
}
