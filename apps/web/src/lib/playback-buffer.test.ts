import { describe, expect, it } from "vitest"
import { bufferStatus, playbackBufferState } from "./playback-buffer"

function ranges(values: Array<[number, number]>): TimeRanges {
  return {
    length: values.length,
    start: (index) => values[index]![0],
    end: (index) => values[index]![1],
  }
}

describe("playback buffer state", () => {
  it("reports only the range containing the playhead", () => {
    expect(playbackBufferState(ranges([[0, 20], [40, 50]]), 12)).toEqual({
      ahead: 8,
      end: 20,
    })
    expect(playbackBufferState(ranges([[0, 20], [40, 50]]), 30)).toEqual({
      ahead: 0,
      end: 30,
    })
  })

  it("formats local buffer diagnostics", () => {
    expect(bufferStatus(12.4, 2_000_000)).toBe("12s buffered · 16.0 Mbps")
    expect(bufferStatus(0)).toBe("0s buffered")
  })
})
