type StereoGain = readonly [left: number, right: number]

const MIX = Math.SQRT1_2
const FRONT_LEFT: StereoGain = [1, 0]
const FRONT_RIGHT: StereoGain = [0, 1]
const CENTER: StereoGain = [MIX, MIX]
const LFE: StereoGain = [0, 0]
const SURROUND_LEFT: StereoGain = [MIX, 0]
const SURROUND_RIGHT: StereoGain = [0, MIX]
const BACK_CENTER: StereoGain = [0.5, 0.5]

/**
 * Stereo gains per input channel, in the WAVE/SMPTE order decoders emit
 * (L R C LFE, then back and side surrounds), following ITU-R BS.775.
 */
const LAYOUTS: Record<number, readonly StereoGain[]> = {
  3: [FRONT_LEFT, FRONT_RIGHT, CENTER],
  4: [FRONT_LEFT, FRONT_RIGHT, SURROUND_LEFT, SURROUND_RIGHT],
  5: [FRONT_LEFT, FRONT_RIGHT, CENTER, SURROUND_LEFT, SURROUND_RIGHT],
  6: [FRONT_LEFT, FRONT_RIGHT, CENTER, LFE, SURROUND_LEFT, SURROUND_RIGHT],
  7: [FRONT_LEFT, FRONT_RIGHT, CENTER, LFE, BACK_CENTER, SURROUND_LEFT, SURROUND_RIGHT],
  8: [
    FRONT_LEFT,
    FRONT_RIGHT,
    CENTER,
    LFE,
    SURROUND_LEFT,
    SURROUND_RIGHT,
    SURROUND_LEFT,
    SURROUND_RIGHT,
  ],
}

// Keeps a full-scale front channel plus center at unity, so dialog stays as loud as the
// fronts; the soft clip below handles the rare peaks where every channel is loud at once.
const OUTPUT_GAIN = 1 / (1 + MIX)
const CLIP_KNEE = 0.9

/**
 * Folds a multichannel buffer down to stereo. Returns undefined when the
 * channel count has no known layout, so the caller can let Web Audio mix it.
 */
export function downmixToStereo(
  channels: readonly Float32Array[],
): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] | undefined {
  const layout = LAYOUTS[channels.length]
  if (!layout) return undefined
  const frames = channels[0]?.length ?? 0
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  channels.forEach((samples, channel) => {
    const [leftGain, rightGain] = layout[channel]
    for (let frame = 0; frame < frames; frame += 1) {
      left[frame] += samples[frame] * leftGain
      right[frame] += samples[frame] * rightGain
    }
  })
  for (let frame = 0; frame < frames; frame += 1) {
    left[frame] = softClip(left[frame] * OUTPUT_GAIN)
    right[frame] = softClip(right[frame] * OUTPUT_GAIN)
  }
  return [left, right]
}

function softClip(sample: number): number {
  const magnitude = Math.abs(sample)
  if (magnitude <= CLIP_KNEE) return sample
  const headroom = 1 - CLIP_KNEE
  return Math.sign(sample) * (CLIP_KNEE + headroom * Math.tanh((magnitude - CLIP_KNEE) / headroom))
}

/**
 * Folds 7.1 (L R C LFE, back L R, side L R) to 5.1 (L R C LFE, surround L R) for
 * outputs with six channels, mixing each side's back and side surrounds at -3 dB.
 */
export function downmix71To51(channels: readonly Float32Array[]): Float32Array<ArrayBuffer>[] {
  const [left, right, center, lfe, backLeft, backRight, sideLeft, sideRight] = channels
  const surround = (back: Float32Array, side: Float32Array) =>
    Float32Array.from(back, (sample, frame) => softClip((sample + side[frame]) * MIX))
  return [
    Float32Array.from(left),
    Float32Array.from(right),
    Float32Array.from(center),
    Float32Array.from(lfe),
    surround(backLeft, sideLeft),
    surround(backRight, sideRight),
  ]
}
