import { describe, expect, it } from "vitest"
import { browserPlaybackError } from "./playback-compatibility"

describe("browserPlaybackError", () => {
  it("distinguishes network failures from incompatible media", () => {
    expect(browserPlaybackError(2)).toContain("could not fetch")
    expect(browserPlaybackError(3)).toContain("could not decode")
    expect(browserPlaybackError(4)).toContain("not supported")
  })

  it("offers the native player when the browser gives no useful error", () => {
    expect(browserPlaybackError()).toContain("desktop app")
  })
})
