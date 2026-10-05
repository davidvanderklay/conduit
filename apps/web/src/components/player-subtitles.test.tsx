// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { InstalledAddon } from "../lib/api"
import * as core from "../lib/core"
import { Player } from "./player"

vi.mock("../lib/progress", () => ({
  usePlaybackProgress: () => ({ progress: { isSuccess: true, data: null }, save: vi.fn() }),
}))
vi.mock("../lib/desktop", async (original) => ({
  ...(await original<typeof import("../lib/desktop")>()),
  isDesktop: () => false,
}))

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const addon: InstalledAddon = {
  id: "subs",
  manifestId: "subs",
  manifestUrl: "https://example.test/manifest.json",
  enabled: true,
  position: 0,
  manifest: {
    id: "subs",
    version: "1",
    name: "Provider",
    resources: ["subtitles"],
    types: ["movie"],
    catalogs: [],
  },
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function track(language: string): TextTrack {
  return { language, label: language, mode: "disabled", cues: [] } as unknown as TextTrack
}

describe("browser subtitle selection", () => {
  let host: HTMLDivElement
  let root: Root
  const nativeTracks = [track("es"), track("en")]
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.setItem(
      "conduit.device-preferences.v1",
      JSON.stringify({ subtitleLanguage: "en", secondarySubtitleLanguage: "es" }),
    )
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    vi.spyOn(HTMLMediaElement.prototype, "textTracks", "get").mockReturnValue(
      Object.assign([], {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as TextTrackList,
    )
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined)
    vi.stubGlobal("fetch", vi.fn())
    nativeTracks.forEach((item) => {
      item.mode = "disabled"
    })
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
  async function render(tracks: TextTrack[], providers: InstalledAddon[] = []) {
    await act(async () => {
      root.render(
        <Player
          url="https://example.test/video.mp4"
          type="movie"
          videoId="movie"
          profileId="profile"
          progressMetadata={{ mediaType: "movie", mediaId: "movie", name: "Movie" }}
          addons={providers}
          onClose={() => undefined}
        />,
      )
    })
    const video = host.querySelector("video")!
    Object.defineProperty(video, "textTracks", {
      value: Object.assign(tracks, { addEventListener: vi.fn(), removeEventListener: vi.fn() }),
      configurable: true,
    })
    Object.defineProperty(video, "readyState", { value: 1, configurable: true })
    await act(async () => {
      video.dispatchEvent(new Event("loadedmetadata"))
    })
    return video
  }
  function click(label: string) {
    const button = [...host.querySelectorAll("button")].find(
      (button) =>
        button.textContent?.trim() === label || button.getAttribute("aria-label") === label,
    )
    expect(button, label).toBeTruthy()
    act(() => button!.click())
  }
  it("selects a primary embedded track", async () => {
    await render(nativeTracks)
    expect(nativeTracks.map((item) => item.mode)).toEqual(["disabled", "showing"])
  })
  it("updates an automatic choice when embedded tracks appear after metadata", async () => {
    const tracks = [nativeTracks[0]!]
    const video = await render(tracks)
    expect(nativeTracks[0]!.mode).toBe("showing")
    tracks.push(nativeTracks[1]!)
    await act(async () => video.dispatchEvent(new Event("loadedmetadata")))
    expect(nativeTracks.map((item) => item.mode)).toEqual(["disabled", "showing"])
  })
  it("waits for delayed add-on lookup before choosing secondary", async () => {
    const lookup = deferred<core.Subtitle[]>()
    vi.spyOn(core, "loadSubtitles").mockReturnValue(lookup.promise)
    await render([nativeTracks[0]!], [addon])
    expect(nativeTracks[0]!.mode).toBe("disabled")
    await act(async () => lookup.resolve([]))
    expect(nativeTracks[0]!.mode).toBe("showing")
  })
  it("preserves explicit Off when lookup finishes", async () => {
    const lookup = deferred<core.Subtitle[]>()
    vi.spyOn(core, "loadSubtitles").mockReturnValue(lookup.promise)
    await render([nativeTracks[0]!], [addon])
    click("Track settings")
    click("Off")
    await act(async () => lookup.resolve([]))
    expect(nativeTracks[0]!.mode).toBe("disabled")
  })
  it("preserves a manual language when a primary add-on arrives", async () => {
    const lookup = deferred<core.Subtitle[]>()
    vi.spyOn(core, "loadSubtitles").mockReturnValue(lookup.promise)
    await render([nativeTracks[0]!], [addon])
    click("Track settings")
    click("Spanish1")
    await act(async () =>
      lookup.resolve([{ id: "en", lang: "eng", url: "https://example.test/en.vtt" }]),
    )
    expect(nativeTracks[0]!.mode).toBe("showing")
    expect(fetch).not.toHaveBeenCalled()
  })
  it("discards an automatic subtitle download completed after manual Off", async () => {
    vi.spyOn(core, "loadSubtitles").mockResolvedValue([
      { id: "en", lang: "en", url: "https://example.test/en.vtt" },
    ])
    const download = deferred<Response>()
    vi.mocked(fetch).mockReturnValue(download.promise)
    const video = await render([nativeTracks[0]!], [addon])
    expect(fetch).toHaveBeenCalledWith("https://example.test/en.vtt")
    click("Track settings")
    click("Off")
    await act(async () =>
      download.resolve(new Response("WEBVTT\n\n00:00.000 --> 00:02.000\nHello")),
    )
    expect(video.querySelector("track")).toBeNull()
    expect(nativeTracks[0]!.mode).toBe("disabled")
  })

  it("turns an unrelated native track off when neither language is available", async () => {
    const unrelated = track("ja")
    unrelated.mode = "showing"
    await render([unrelated])
    expect(unrelated.mode).toBe("disabled")
  })
})
