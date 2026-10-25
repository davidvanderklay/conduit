import { afterEach, describe, expect, it, vi } from "vitest"
import { autoSyncSubtitle, type VideoRangeReader } from "./subtitle-auto-sync"

describe("subtitle auto sync", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("asks for an add-on subtitle before reading the video", async () => {
    const readRange = vi.fn<VideoRangeReader>()
    expect(await autoSyncSubtitle(readRange, undefined)).toEqual({
      synced: false,
      reason: "Choose an add-on subtitle to sync.",
    })
    expect(readRange).not.toHaveBeenCalled()
  })

  it("reads the ranges the core asks for and explains streams it cannot index", async () => {
    vi.stubGlobal("fetch", async () => new Response("1\n00:00:01,000 --> 00:00:02,000\nHi"))
    const playlist = "#EXTM3U\n#EXT-X-VERSION:3\n"
    const readRange = vi.fn<VideoRangeReader>(async () => ({
      data: btoa(playlist),
      size: playlist.length,
    }))
    expect(await autoSyncSubtitle(readRange, "https://subs.example/en.srt")).toEqual({
      synced: false,
      reason: "Auto sync works with MKV and MP4 videos.",
    })
    expect(readRange).toHaveBeenCalledWith(0, 256 * 1024)
  })
})
