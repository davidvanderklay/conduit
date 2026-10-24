import { describe, expect, it } from "vitest"
import { externalPlaylist, playlistFileName } from "./external-player"

describe("external player playlists", () => {
  it("keeps a multi-line title on its EXTINF line", () => {
    expect(externalPlaylist("https://cdn.test/a.mkv", "Show\nS1 E2 · Pilot")).toBe(
      "#EXTM3U\n#EXTINF:-1,Show S1 E2 · Pilot\nhttps://cdn.test/a.mkv\n",
    )
  })

  it("names files without path separators or reserved characters", () => {
    expect(playlistFileName('Show: "Part 1/2"?')).toBe("Show Part 1 2.m3u")
    expect(playlistFileName(" / ")).toBe("stream.m3u")
  })
})
