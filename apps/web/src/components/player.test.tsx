// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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

function track(language: string): TextTrack {
  return { language, label: language, mode: "disabled", cues: [] } as unknown as TextTrack
}

describe("browser player shortcuts", () => {
  let host: HTMLDivElement
  let root: Root
  let video: HTMLVideoElement
  const english = track("en")
  const next = vi.fn()

  beforeEach(async () => {
    vi.useFakeTimers()
    english.mode = "disabled"
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
    await act(async () => {
      root.render(
        <Player
          url="https://example.test/video.mp4"
          type="movie"
          videoId="movie"
          profileId="profile"
          progressMetadata={{ mediaType: "movie", mediaId: "movie", name: "Movie" }}
          addons={[]}
          onNextEpisode={next}
          onClose={() => undefined}
        />,
      )
    })
    video = host.querySelector("video")!
    Object.defineProperty(video, "textTracks", {
      value: Object.assign([english], { addEventListener: vi.fn(), removeEventListener: vi.fn() }),
      configurable: true,
    })
    Object.defineProperty(video, "readyState", { value: 1, configurable: true })
    await act(async () => video.dispatchEvent(new Event("loadedmetadata")))
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.restoreAllMocks()
    vi.useRealTimers()
    next.mockClear()
  })

  function press(key: string, init: KeyboardEventInit = {}) {
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }))
    })
  }

  const flash = () => host.querySelector('[aria-live="polite"]')?.textContent

  it("controls volume, speed, and playback from the keyboard", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
    video.volume = 0.5

    press("ArrowUp")
    expect(video.volume).toBeCloseTo(0.55)
    expect(flash()).toBe("Volume 55%")

    press("m")
    expect(video.muted).toBe(true)

    press("]")
    expect(video.playbackRate).toBe(1.25)
    expect(flash()).toBe("1.25×")

    press(" ")
    expect(play).toHaveBeenCalled()

    press("N", { shiftKey: true })
    expect(next).toHaveBeenCalledOnce()
  })

  it("toggles subtitles off and back on", async () => {
    expect(english.mode).toBe("showing")

    await act(async () => press("c"))
    expect(english.mode).toBe("disabled")
    expect(flash()).toBe("Subtitles off")

    await act(async () => press("c"))
    expect(english.mode).toBe("showing")
  })

  it("leaves keys typed into fields alone", () => {
    const field = document.createElement("input")
    host.append(field)
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true }))
    expect(video.muted).toBe(false)
  })
})
