export interface PlaybackBufferState {
  ahead: number
  end: number
}

export function playbackBufferState(
  ranges: Pick<TimeRanges, "length" | "start" | "end">,
  currentTime: number,
): PlaybackBufferState {
  for (let index = 0; index < ranges.length; index += 1) {
    const start = ranges.start(index)
    const end = ranges.end(index)
    if (start <= currentTime + 0.25 && end >= currentTime) {
      return {
        ahead: Math.max(0, end - currentTime),
        end,
      }
    }
  }
  return { ahead: 0, end: currentTime }
}
