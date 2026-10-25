/** Analysis frame length in seconds; output overlaps frames by half. */
const FRAME_SECONDS = 0.04
/** How far from its nominal position a frame may be taken to line up with the last one. */
const TOLERANCE_SECONDS = 0.012
/** Correlation is measured on every n-th sample, which is plenty for alignment. */
const CORRELATION_STEP = 4
/** Candidate spacing of the coarse alignment pass. */
const COARSE_STEP = 4

/** A stretched chunk: its samples, and the media timestamp and duration they cover. */
export interface StretchedAudio {
  channels: Float32Array<ArrayBuffer>[]
  timestamp: number
  mediaDuration: number
}

/**
 * Changes audio speed without changing pitch, with WSOLA: output is built from
 * overlapping, windowed input frames taken `rate` times faster than they are
 * written, each shifted slightly so its waveform lines up with the previous one.
 * Keeps state across `push` calls, so feed one continuous stream per instance.
 */
export class TimeStretcher {
  readonly #rate: number
  readonly #frame: number
  readonly #hop: number
  readonly #tolerance: number
  readonly #window: Float32Array
  /** Input not yet consumed, per channel, starting at `#inputStart` samples into the stream. */
  #input: Float32Array[] = []
  #inputStart = 0
  /** Stream position, in samples, of the first sample pushed, and its media timestamp. */
  #origin?: { timestamp: number; sampleRate: number }
  /** Nominal input position of the next frame, in samples from the stream start. */
  #position = 0
  /** Input position the previous frame was actually taken from. */
  #previous = -1
  /** Second half of the previous frame, windowed, waiting to be overlap-added. */
  #tail: Float32Array[] = []

  constructor(rate: number, sampleRate: number) {
    this.#rate = rate
    this.#hop = Math.round((sampleRate * FRAME_SECONDS) / 2)
    this.#frame = this.#hop * 2
    this.#tolerance = Math.round(sampleRate * TOLERANCE_SECONDS)
    // A periodic Hann window: two of them half a frame apart sum to one.
    this.#window = Float32Array.from(
      { length: this.#frame },
      (_, index) => 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / this.#frame),
    )
  }

  /** Adds decoded audio that continues the stream, and returns whatever output it completes. */
  push(
    channels: readonly Float32Array[],
    timestamp: number,
    sampleRate: number,
  ): StretchedAudio | undefined {
    this.#origin ??= { timestamp, sampleRate }
    if (this.#input.length === 0) {
      this.#input = channels.map(() => new Float32Array(0))
      this.#tail = channels.map(() => new Float32Array(this.#hop))
    }
    this.#input = this.#input.map((existing, channel) => {
      const added = channels[channel] ?? channels[0]
      const joined = new Float32Array(existing.length + added.length)
      joined.set(existing)
      joined.set(added, existing.length)
      return joined
    })
    return this.#process()
  }

  #process(): StretchedAudio | undefined {
    const available = this.#inputStart + this.#input[0].length
    const analysisHop = this.#hop * this.#rate
    const startPosition = this.#position
    const output: Float32Array[][] = this.#input.map(() => [])
    while (
      Math.round(this.#position) + this.#tolerance + this.#frame <= available &&
      this.#previous + this.#hop + this.#frame <= available
    ) {
      const start = this.#bestStart(Math.round(this.#position))
      for (let channel = 0; channel < this.#input.length; channel += 1) {
        const input = this.#input[channel]
        const tail = this.#tail[channel]
        const offset = start - this.#inputStart
        const hop = new Float32Array(this.#hop)
        for (let index = 0; index < this.#hop; index += 1) {
          hop[index] = tail[index] + this.#window[index] * input[offset + index]
          tail[index] = this.#window[index + this.#hop] * input[offset + this.#hop + index]
        }
        output[channel].push(hop)
      }
      this.#previous = start
      this.#position += analysisHop
    }
    const hops = output[0].length
    if (hops === 0) return undefined
    this.#trim()
    const { timestamp, sampleRate } = this.#origin!
    return {
      channels: output.map((parts) => {
        const joined = new Float32Array(hops * this.#hop)
        parts.forEach((part, index) => joined.set(part, index * this.#hop))
        return joined
      }),
      timestamp: timestamp + startPosition / sampleRate,
      mediaDuration: (hops * analysisHop) / sampleRate,
    }
  }

  /** Picks the frame start near `nominal` whose start best continues the previous frame. */
  #bestStart(nominal: number): number {
    if (this.#previous < 0) return nominal
    const first = Math.max(this.#inputStart, nominal - this.#tolerance)
    const last = nominal + this.#tolerance
    // A coarse pass over every few candidates, then a fine pass around the best one.
    let best = this.#bestIn(first, last, COARSE_STEP, nominal)
    best = this.#bestIn(
      Math.max(first, best - COARSE_STEP),
      Math.min(last, best + COARSE_STEP),
      1,
      best,
    )
    return best
  }

  /**
   * Scores candidates by correlating their first half frame with the input that
   * followed the previous frame, on the front left and right channels only.
   */
  #bestIn(first: number, last: number, step: number, fallback: number): number {
    const natural = this.#previous + this.#hop - this.#inputStart
    const fronts = this.#input.slice(0, 2)
    let best = fallback
    let bestScore = -Infinity
    for (let candidate = first; candidate <= last; candidate += step) {
      const offset = candidate - this.#inputStart
      let score = 0
      for (const input of fronts) {
        for (let index = 0; index < this.#hop; index += CORRELATION_STEP) {
          score += input[offset + index] * input[natural + index]
        }
      }
      if (score > bestScore) {
        bestScore = score
        best = candidate
      }
    }
    return best
  }

  /** Drops input no later frame can reach. */
  #trim() {
    const keep = Math.min(this.#previous + this.#hop, Math.round(this.#position) - this.#tolerance)
    const drop = keep - this.#inputStart
    if (drop <= 0) return
    this.#input = this.#input.map((input) => input.slice(drop))
    this.#inputStart = keep
  }
}
