import type { VideoSample } from "mediabunny"

/** Peak luminance in nits the stream's metadata declares for each sample, read by the presenter. */
export const hdrPeaks = new WeakMap<VideoSample, number>()

/**
 * Follows a stream's HDR metadata across frames. Each value persists until the
 * stream sends a new one: MaxCLL and the mastering display peak usually arrive
 * once, and HDR10+ streams may only repeat their scene peaks when they change.
 */
export class HdrPeakTracker {
  #scene?: number
  #content?: number

  /** Takes FFmpeg's [HDR10+, MaxCLL, mastering] peaks and returns the current peak. */
  update([scene, maxCll, mastering]: readonly number[]): number | undefined {
    if (scene > 0) this.#scene = scene
    // MaxCLL describes the content itself; the mastering display only bounds it.
    const content = maxCll > 0 ? maxCll : mastering > 0 ? mastering : undefined
    if (content) this.#content = content
    return this.#scene ?? this.#content
  }
}
