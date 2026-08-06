import { describe, expect, it } from "vitest"
import { defaultSubtitleTrack } from "./electron-player-overlay"

describe("Electron subtitle selection", () => {
  it("prefers an embedded track over a selected external track", () => {
    const external = {
      id: 1,
      type: "sub" as const,
      title: "English · AIOStreams",
      selected: true,
      external: true,
    }
    const embedded = {
      id: 2,
      type: "sub" as const,
      title: "English",
      selected: false,
      external: false,
    }

    expect(defaultSubtitleTrack({
      code: "en",
      label: "English",
      tracks: [external, embedded],
    })).toBe(embedded)
  })

  it("falls back to an external track when there is no embedded option", () => {
    const external = {
      id: 1,
      type: "sub" as const,
      title: "English · AIOStreams",
      selected: false,
      external: true,
    }

    expect(defaultSubtitleTrack({
      code: "en",
      label: "English",
      tracks: [external],
    })).toBe(external)
  })
})
