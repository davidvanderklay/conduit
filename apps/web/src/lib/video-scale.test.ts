import { describe, expect, it } from "vitest"
import { mpvVideoScaleCommands, nextVideoScale, videoObjectFit } from "./video-scale"

describe("video scaling", () => {
  it("maps browser scaling modes", () => {
    expect(videoObjectFit("fit")).toBe("contain")
    expect(videoObjectFit("crop")).toBe("cover")
    expect(videoObjectFit("stretch")).toBe("fill")
  })

  it("maps native scaling modes to mpv aspect and panscan properties", () => {
    const viewport = { width: 1920, height: 1080 }
    expect(mpvVideoScaleCommands("fit", viewport)).toContainEqual(["set", "panscan", 0])
    expect(mpvVideoScaleCommands("crop", viewport)).toContainEqual(["set", "panscan", 1])
    expect(mpvVideoScaleCommands("stretch", viewport)).toContainEqual([
      "set",
      "video-aspect-override",
      "1920:1080",
    ])
  })

  it("cycles through the three modes", () => {
    expect(nextVideoScale("fit")).toBe("crop")
    expect(nextVideoScale("crop")).toBe("stretch")
    expect(nextVideoScale("stretch")).toBe("fit")
  })
})
