import { describe, expect, it } from "vitest"
import { isDesktopBuffering, isDesktopInitialLoading } from "./desktop-player-state"

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
})
