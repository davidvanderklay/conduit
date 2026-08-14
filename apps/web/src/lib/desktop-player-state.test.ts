import { describe, expect, it } from "vitest"
import {
  isDesktopBuffering,
  isDesktopInitialLoading,
  shouldShowDesktopPlayPause,
} from "./desktop-player-state"

const ready = { firstFrameReady: true, loading: false }

describe("desktop player state", () => {
  it("keeps initial loading and buffering mutually exclusive", () => {
    expect(isDesktopInitialLoading(undefined)).toBe(true)
    expect(isDesktopBuffering(undefined)).toBe(false)
    expect(isDesktopInitialLoading({ firstFrameReady: false, loading: true })).toBe(true)
    expect(isDesktopBuffering({ firstFrameReady: false, loading: true })).toBe(false)
    expect(isDesktopInitialLoading({ firstFrameReady: true, loading: true })).toBe(false)
    expect(isDesktopBuffering({ firstFrameReady: true, loading: true })).toBe(true)
  })

  it("gives errors priority over loading indicators", () => {
    expect(isDesktopInitialLoading(undefined, new Error("failed"))).toBe(false)
    expect(isDesktopBuffering({ firstFrameReady: true, loading: true }, "failed")).toBe(false)
  })

  it("hides play/pause while seeking or buffering", () => {
    expect(shouldShowDesktopPlayPause(ready, false)).toBe(true)
    expect(shouldShowDesktopPlayPause(ready, true)).toBe(false)
    expect(shouldShowDesktopPlayPause({ ...ready, loading: true }, false)).toBe(false)
    expect(shouldShowDesktopPlayPause({ firstFrameReady: false, loading: false }, false)).toBe(false)
  })
})
