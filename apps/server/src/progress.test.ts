import { describe, expect, it } from "vitest"
import { isPlaybackComplete } from "./routes.js"

describe("watch completion", () => {
  it("completes at ninety percent", () => {
    expect(isPlaybackComplete(90_000, 100_000)).toBe(true)
    expect(isPlaybackComplete(89_999, 1_000_000)).toBe(false)
  })

  it("completes near the credits", () => {
    expect(isPlaybackComplete(480_000, 600_000)).toBe(true)
    expect(isPlaybackComplete(479_999, 600_000)).toBe(false)
  })

  it("does not complete media without a known duration", () => {
    expect(isPlaybackComplete(100_000, 0)).toBe(false)
  })
})
