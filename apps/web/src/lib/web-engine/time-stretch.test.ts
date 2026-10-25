import { describe, expect, it } from "vitest"
import { TimeStretcher, type StretchedAudio } from "./time-stretch"

const SAMPLE_RATE = 48000

/** Stretches two seconds of a 440 Hz tone, pushed in decoder-sized chunks. */
function stretchTone(rate: number): StretchedAudio[] {
  const tone = Float32Array.from(
    { length: SAMPLE_RATE * 2 },
    (_, index) => 0.5 * Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE),
  )
  const stretcher = new TimeStretcher(rate, SAMPLE_RATE)
  const chunks: StretchedAudio[] = []
  for (let start = 0; start < tone.length; start += 1024) {
    const samples = tone.subarray(start, start + 1024)
    const chunk = stretcher.push([samples, samples], 10 + start / SAMPLE_RATE, SAMPLE_RATE)
    if (chunk) chunks.push(chunk)
  }
  return chunks
}

/** Frequency from upward zero crossings, skipping the window's fade-in. */
function frequency(samples: Float32Array): number {
  let crossings = 0
  for (let index = 2000; index < samples.length; index += 1) {
    if (samples[index - 1] < 0 && samples[index] >= 0) crossings += 1
  }
  return (crossings * SAMPLE_RATE) / (samples.length - 2000)
}

describe("TimeStretcher", () => {
  it.each([0.5, 1.5, 2])("keeps pitch and scales duration at %s×", (rate) => {
    const chunks = stretchTone(rate)
    const output = new Float32Array(
      chunks.reduce((total, chunk) => total + chunk.channels[0].length, 0),
    )
    chunks.reduce(
      (offset, chunk) => (output.set(chunk.channels[0], offset), offset + chunk.channels[0].length),
      0,
    )
    expect(frequency(output)).toBeCloseTo(440, -1)
    // Frames splice in phase: no step is much steeper than the tone's own (about 0.029).
    let steepest = 0
    for (let index = 2001; index < output.length; index += 1) {
      steepest = Math.max(steepest, Math.abs(output[index] - output[index - 1]))
    }
    expect(steepest).toBeLessThan(0.04)
    // Output covers the media it reports, played back `rate` times faster.
    const media = chunks.reduce((total, chunk) => total + chunk.mediaDuration, 0)
    expect(output.length / SAMPLE_RATE).toBeCloseTo(media / rate, 3)
    expect(media).toBeGreaterThan(1.9)
  })

  it("reports contiguous media timestamps from the stream's start", () => {
    const chunks = stretchTone(1.25)
    expect(chunks[0].timestamp).toBe(10)
    for (let index = 1; index < chunks.length; index += 1) {
      const previous = chunks[index - 1]
      expect(chunks[index].timestamp).toBeCloseTo(previous.timestamp + previous.mediaDuration, 6)
    }
  })
})
