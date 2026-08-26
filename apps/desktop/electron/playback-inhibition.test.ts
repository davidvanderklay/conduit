import { describe, expect, it, vi } from "vitest"
import { createPlaybackInhibitor } from "./playback-inhibition"

describe("playback sleep inhibition", () => {
  it("blocks display sleep while playback is active and releases it when playback stops", () => {
    const start = vi.fn(() => 42)
    const stop = vi.fn()
    const inhibitor = createPlaybackInhibitor({ start, stop })

    inhibitor.setPlaying(true)
    inhibitor.setPlaying(true)
    expect(start).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledWith("prevent-display-sleep")
    expect(stop).not.toHaveBeenCalled()

    inhibitor.setPlaying(false)
    expect(stop).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledWith(42)
  })

  it("does not start a blocker for paused playback", () => {
    const start = vi.fn(() => 42)
    const inhibitor = createPlaybackInhibitor({ start, stop: vi.fn() })

    inhibitor.setPlaying(false)

    expect(start).not.toHaveBeenCalled()
  })
})
