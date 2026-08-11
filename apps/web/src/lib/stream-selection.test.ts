import { describe, expect, it } from "vitest"
import {
  isPlayableStreamUrl,
  playbackSourceForStream,
  selectSavedStream,
  selectNextEpisodeStream,
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

describe("selectNextEpisodeStream", () => {
  it("prefers the current provider and matching stream traits", () => {
    const current = stream("current", "AIOStreams", {
      title: "1080p HEVC",
      behaviorHints: { bingeGroup: "release-a" },
    })
    const result = selectNextEpisodeStream([
      stream("other", "Other", { title: "1080p HEVC" }),
      stream("provider-low", "AIOStreams", { title: "720p H264" }),
      stream("provider-match", "AIOStreams", {
        title: "1080p HEVC",
        behaviorHints: { bingeGroup: "release-a" },
      }),
    ], current)
    expect(result?.key).toBe("provider-match")
  })

  it("uses a deterministic provider/key fallback without a current match", () => {
    const result = selectNextEpisodeStream([
      stream("z", "Provider B"),
      stream("b", "Provider A"),
      stream("a", "Provider A"),
    ])
    expect(result?.key).toBe("a")
  })

  it("rejects unsafe and malformed playback URLs", () => {
    expect(isPlayableStreamUrl("javascript:alert(1)")).toBe(false)
    expect(isPlayableStreamUrl("file:///tmp/video.mp4")).toBe(false)
    expect(isPlayableStreamUrl("not a url")).toBe(false)
    expect(isPlayableStreamUrl("https://example.com/video.mp4")).toBe(true)
  })

  it("matches a saved source without persisting transient URL tokens", () => {
    const saved = playbackSourceForStream(stream("saved", "Provider", {
      addonId: "addon-1",
      url: "https://video.example/movie.m3u8?token=old&quality=1080p",
      title: "1080p HEVC",
    }))
    const result = selectSavedStream([
      stream("fresh", "Provider", {
        addonId: "addon-1",
        url: "https://video.example/movie.m3u8?token=new&quality=1080p",
        title: "1080p HEVC",
      }),
    ], saved)
    expect(saved?.sourceKey).toBe("url:https://video.example/movie.m3u8?quality=1080p")
    expect(result?.key).toBe("fresh")
  })

  it("does not match a saved source from another add-on", () => {
    const saved = playbackSourceForStream(stream("saved", "Provider", { addonId: "addon-1" }))
    expect(selectSavedStream([
      stream("same-looking", "Provider", { addonId: "addon-2" }),
    ], saved)).toBeUndefined()
  })
})
