import { describe, expect, it } from "vitest"
import {
  isPlayableStreamUrl,
  playbackSourceForStream,
  selectSavedStream,
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

  it("matches a saved source when the provider rotates the URL path token", () => {
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

  it("does not match a saved source from another add-on", () => {
    const saved = playbackSourceForStream(stream("saved", "Provider", { addonId: "addon-1" }))
    expect(
      selectSavedStream([stream("same-looking", "Provider", { addonId: "addon-2" })], saved),
    ).toBeUndefined()
  })
})
