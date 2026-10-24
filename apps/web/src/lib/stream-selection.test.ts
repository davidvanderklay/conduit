import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  isPlayableStreamUrl,
  playbackSourceForStream,
  rankAutomaticStreams,
  selectSavedStream,
  selectSingleAutoStream,
  streamPlaybackUrl,
  type AutoSelectableStream,
} from "./stream-selection"

const stream = (
  key: string,
  addonName: string,
  values: Partial<AutoSelectableStream> = {},
): AutoSelectableStream => ({
  key,
  addonName,
  url: `https://example.com/${key}.mp4`,
  ...values,
})

describe("stream selection", () => {
  beforeEach(() => vi.stubGlobal("window", {}))
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    [
      "https://video.example/play?file=My%20Movie.mkv",
      "url:https://video.example/play?file=My Movie.mkv",
    ],
    [
      "https://video.example/play?file=My%20Movie.mkv",
      "url:https://video.example/play?file=My%20Movie.mkv",
    ],
    ["https://video.example/?token=fresh", "url:https://video.example"],
  ])("resumes a persisted legacy source for %s through WASM", (url, sourceKey) => {
    const candidate = stream("saved", "Provider", { addonId: "addon-1", url })
    const saved = { addonId: "addon-1", sourceKey, kind: "url" as const }
    expect(selectSavedStream([candidate], saved)).toBe(candidate)
    expect(rankAutomaticStreams([stream("other", "Other"), candidate], undefined, saved)[0]).toBe(
      candidate,
    )
  })

  it("rejects unsafe and malformed playback URLs", () => {
    expect(isPlayableStreamUrl("javascript:alert(1)")).toBe(false)
    expect(isPlayableStreamUrl("file:///tmp/video.mp4")).toBe(false)
    expect(isPlayableStreamUrl("not a url")).toBe(false)
    expect(isPlayableStreamUrl("https://example.com/video.mp4")).toBe(true)
  })

  it("matches a saved source without persisting transient URL tokens", () => {
    const saved = playbackSourceForStream(
      stream("saved", "Provider", {
        addonId: "addon-1",
        url: "https://video.example/movie.m3u8?token=old&quality=1080p",
        title: "1080p HEVC",
      }),
    )
    const result = selectSavedStream(
      [
        stream("fresh", "Provider", {
          addonId: "addon-1",
          url: "https://video.example/movie.m3u8?token=new&quality=1080p",
          title: "1080p HEVC",
        }),
      ],
      saved,
    )
    expect(saved?.sourceKey).toBe("url:https://video.example/movie.m3u8?quality=1080p")
    expect(result?.key).toBe("fresh")
  })

  it("matches a saved source by binge group when the provider rotates the URL path token", () => {
    const filename = "Movie.2026.1080p.WEB-DL.mkv"
    const saved = playbackSourceForStream(
      stream("saved", "Provider", {
        addonId: "addon-1",
        url: "https://video.example/playback/old-signed-token",
        name: "1080P",
        behaviorHints: { filename, bingeGroup: "provider|1080p|release" },
      }),
    )
    const result = selectSavedStream(
      [
        stream("fresh", "Provider", {
          addonId: "addon-1",
          url: "https://video.example/playback/new-signed-token",
          name: "1080P",
          behaviorHints: { filename, bingeGroup: "provider|1080p|release" },
        }),
      ],
      saved,
    )

    expect(result?.key).toBe("fresh")
  })

  it("matches an exact source from another add-on when the identity is stable", () => {
    const saved = playbackSourceForStream(
      stream("saved", "Provider", {
        addonId: "addon-1",
        url: "https://video.example/movie.mp4",
      }),
    )
    const result = selectSavedStream(
      [
        stream("same-source", "Other provider", {
          addonId: "addon-2",
          url: "https://video.example/movie.mp4",
        }),
      ],
      saved,
    )
    expect(result?.key).toBe("same-source")
  })

  it("only matches a unique binge group when the saved add-on is absent", () => {
    const saved = playbackSourceForStream(
      stream("saved", "Provider", {
        addonId: "addon-1",
        url: "https://video.example/old-token",
        behaviorHints: { bingeGroup: "release-1080p" },
      }),
    )
    expect(
      selectSavedStream(
        [
          stream("same-looking", "Provider 2", {
            addonId: "addon-2",
            behaviorHints: { bingeGroup: "release-1080p" },
          }),
          stream("ambiguous", "Provider 3", {
            addonId: "addon-3",
            behaviorHints: { bingeGroup: "release-1080p" },
          }),
        ],
        saved,
      ),
    ).toBeUndefined()
  })

  it("does not fuzzy-match a changed stream without a binge group", () => {
    const filename = "Movie.2026.1080p.WEB-DL.mkv"
    const saved = playbackSourceForStream(
      stream("saved", "Provider", {
        addonId: "addon-1",
        url: "https://video.example/old-token",
        behaviorHints: { filename },
      }),
    )
    const changed = stream("changed", "Provider", {
      addonId: "addon-1",
      url: "https://video.example/new-token",
      behaviorHints: { filename },
    })

    expect(selectSavedStream([changed], saved)).toBeUndefined()
  })

  it("auto-selects the only valid fallback stream", () => {
    const saved = stream("saved", "Provider", { addonId: "addon-1" })
    const fallback = stream("fallback", "Provider", { addonId: "addon-2" })
    expect(selectSingleAutoStream([saved, fallback], saved)?.key).toBe("fallback")
    expect(selectSingleAutoStream([saved, fallback])).toBeUndefined()
  })

  it("plays torrents as magnets only where the shell supports P2P", () => {
    const torrent = stream("torrent", "Torrentio", {
      url: undefined,
      infoHash: "A".repeat(40),
      fileIdx: 3,
      sources: ["tracker:udp://tracker.example:1337/announce", "dht:" + "a".repeat(40)],
    })
    expect(streamPlaybackUrl(torrent)).toBeUndefined()
    expect(selectSingleAutoStream([torrent])).toBeUndefined()

    vi.stubGlobal("window", { __CONDUIT_ELECTRON__: { p2p: true } })
    const magnet = new URL(streamPlaybackUrl(torrent)!)
    expect(magnet.protocol).toBe("magnet:")
    expect(magnet.searchParams.get("xt")).toBe(`urn:btih:${"A".repeat(40)}`)
    expect(magnet.searchParams.get("so")).toBe("3")
    expect(magnet.searchParams.getAll("tr")).toEqual(["udp://tracker.example:1337/announce"])
    expect(selectSingleAutoStream([torrent])).toBe(torrent)
    expect(streamPlaybackUrl(stream("direct", "Provider"))).toBe("https://example.com/direct.mp4")
  })
})
