// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  DesktopPlayer,
  dedupeAddonSubtitles,
  filterAddedAddonSubtitles,
  nativePlaybackEnded,
  nativePlaybackDescription,
  usesExpandedPlayerControls,
} from "./desktop-player"

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const snapshot = {
  running: true,
  ended: false,
  paused: false,
  loading: false,
  firstFrameReady: true,
  position: 10,
  duration: 100,
  bufferedDuration: 30,
  volume: 80,
  playbackPath: "directPlay" as const,
  container: "matroska",
  videoCodec: "hevc",
  audioCodec: "eac3",
  hardwareDecoder: "nvdec",
  tracks: [
    {
      id: 1,
      type: "audio" as const,
      title: "English",
      selected: true,
      external: false,
    },
    {
      id: 2,
      type: "audio" as const,
      title: "Commentary",
      selected: false,
      external: false,
    },
    {
      id: 3,
      type: "sub" as const,
      title: "Spanish",
      selected: false,
      external: false,
    },
  ],
}

const desktop = vi.hoisted(() => ({
  nativePlayerCommand: vi.fn(async () => undefined),
  nativeFullscreen: vi.fn(async () => false),
  nativePlayerSnapshot: vi.fn(async () => snapshot),
  openNativePlayer: vi.fn(async () => snapshot),
  redrawNativeSurface: vi.fn(async () => undefined),
  refreshNativeSurface: vi.fn(async () => undefined),
  resetNativeOverlaySurface: vi.fn(async () => undefined),
  stopNativePlayer: vi.fn(async () => undefined),
  toggleNativeFullscreen: vi.fn(async () => false),
}))

describe("native playback status", () => {
  it("reports codecs and the active hardware decoder", () => {
    expect(nativePlaybackDescription(snapshot)).toBe(
      "Direct Play · MATROSKA · HEVC / EAC3 · Hardware (nvdec)",
    )
  })

  it("reports software decoding once video metadata is known", () => {
    expect(
      nativePlaybackDescription({
        ...snapshot,
        audioCodec: undefined,
        hardwareDecoder: undefined,
      }),
    ).toBe("Direct Play · MATROSKA · HEVC · Software")
  })
})

vi.mock("../lib/desktop", () => desktop)
vi.mock("../lib/progress", () => ({
  usePlaybackProgress: () => ({
    progress: { data: null },
    save: vi.fn(async () => undefined),
  }),
}))

describe("DesktopPlayer track menus", () => {
  let host: HTMLDivElement
  let root: Root
  let startupOverlayResets: number

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    )
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle))
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)

    await act(async () => {
      root.render(
        <DesktopPlayer
          url="https://example.com/video.mp4"
          type="movie"
          videoId="tt123"
          profileId="00000000-0000-4000-8000-000000000001"
          progressMetadata={{ mediaType: "movie", mediaId: "tt123", name: "Test video" }}
          addons={[]}
          onClose={() => undefined}
        />,
      )
      await Promise.resolve()
    })
    act(() => vi.advanceTimersByTime(1))
    startupOverlayResets = desktop.resetNativeOverlaySurface.mock.calls.length
    vi.clearAllMocks()
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.documentElement.classList.remove("native-playback")
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it("resets stale overlay pixels after native playback opens", () => {
    expect(startupOverlayResets).toBe(1)
  })

  it("clears the initial loading overlay when media duration becomes available", async () => {
    desktop.openNativePlayer.mockResolvedValueOnce({
      ...snapshot,
      duration: 0,
      firstFrameReady: false,
    })
    desktop.nativePlayerSnapshot.mockResolvedValueOnce(snapshot)

    await act(async () => {
      root.render(
        <DesktopPlayer
          url="https://example.com/next-video.mp4"
          type="movie"
          videoId="tt456"
          profileId="00000000-0000-4000-8000-000000000001"
          progressMetadata={{ mediaType: "movie", mediaId: "tt456", name: "Next video" }}
          addons={[]}
          onClose={() => undefined}
        />,
      )
      await Promise.resolve()
    })
    expect(document.querySelector('[aria-label="Video loading"]')).not.toBeNull()
    act(() => vi.advanceTimersByTime(4000))
    expect(document.querySelector(".native-player")?.className).toContain("cursor-default")
    for (const region of document.querySelectorAll<HTMLElement>("[data-player-chrome]")) {
      expect(region.classList.contains("visible")).toBe(true)
    }
    desktop.resetNativeOverlaySurface.mockClear()

    await act(async () => {
      vi.advanceTimersByTime(250)
      await Promise.resolve()
    })
    act(() => vi.advanceTimersByTime(1))

    expect(document.querySelector('[aria-label="Video loading"]')).toBeNull()
    expect(desktop.resetNativeOverlaySurface).toHaveBeenCalledOnce()
  })

  it("does not mount the center loading overlay for cache pauses", async () => {
    desktop.nativePlayerSnapshot.mockResolvedValueOnce({
      ...snapshot,
      loading: true,
    })

    await act(async () => {
      vi.advanceTimersByTime(250)
      await Promise.resolve()
    })

    expect(document.querySelector('[aria-label="Video loading"]')).toBeNull()
    expect(document.querySelector('[aria-label="Video buffering"]')).not.toBeNull()
  })

  it("uses the media artwork while the first frame is loading", async () => {
    desktop.openNativePlayer.mockResolvedValueOnce({
      ...snapshot,
      duration: 0,
      firstFrameReady: false,
    })

    await act(async () => {
      root.render(
        <DesktopPlayer
          url="https://example.com/artwork-video.mp4"
          type="movie"
          videoId="tt-artwork"
          profileId="00000000-0000-4000-8000-000000000001"
          progressMetadata={{ mediaType: "movie", mediaId: "tt-artwork", name: "Artwork video" }}
          artwork={{
            background: "https://example.com/background.jpg",
            logo: "https://example.com/logo.png",
            poster: "https://example.com/poster.jpg",
          }}
          addons={[]}
          onClose={() => undefined}
        />,
      )
      await Promise.resolve()
    })

    expect(document.querySelector('[aria-label="Video loading"]')).not.toBeNull()
    expect(document.querySelector('img[src="https://example.com/background.jpg"]')).not.toBeNull()
    expect(document.querySelector('img[src="https://example.com/logo.png"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="Video buffering"]')).toBeNull()
  })

  it("keeps play/pause visible while buffering", async () => {
    desktop.nativePlayerSnapshot.mockResolvedValueOnce({
      ...snapshot,
      loading: true,
      firstFrameReady: true,
    })

    await act(async () => {
      vi.advanceTimersByTime(250)
      await Promise.resolve()
    })

    const playPause = button("Pause")
    expect(playPause.parentElement?.className).not.toContain("invisible")
    const buffering = document.querySelector('[aria-label="Video buffering"]')
    expect(buffering).not.toBeNull()
    expect(buffering?.querySelector("svg")?.getAttribute("class")).toContain("animate-spin")
  })

  it("unmounts the menu when its close button is clicked", () => {
    click(button("Audio: English"))
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    desktop.refreshNativeSurface.mockClear()
    desktop.redrawNativeSurface.mockClear()
    desktop.resetNativeOverlaySurface.mockClear()

    click(button("Close audio menu"))
    act(() => vi.advanceTimersByTime(1))

    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(desktop.refreshNativeSurface).not.toHaveBeenCalled()
    expect(desktop.redrawNativeSurface).toHaveBeenCalled()
    expect(desktop.resetNativeOverlaySurface).toHaveBeenCalledOnce()
  })

  it("does not animate or resize the full control regions", () => {
    const chrome = document.querySelectorAll<HTMLElement>("[data-player-chrome]")

    expect(chrome).toHaveLength(2)
    for (const region of chrome) {
      expect(region.className).not.toContain("transition")
      expect(region.className).not.toContain("opacity-")
    }
  })

  it("shows the media title beside a back control", () => {
    const back = button("Back to details")
    const title = document.querySelector("[data-player-chrome='top'] h2")

    expect(back.querySelector("svg")?.classList.contains("rotate-180")).toBe(true)
    expect(title?.textContent).toBe("Test video")
    expect(back.compareDocumentPosition(title!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("expands controls for large resized windows without requiring fullscreen", () => {
    expect(usesExpandedPlayerControls(1280, 800)).toBe(true)
    expect(usesExpandedPlayerControls(1199, 800)).toBe(false)
    expect(usesExpandedPlayerControls(1600, 699)).toBe(false)
  })

  it("does not repeatedly reset the overlay during a fullscreen transition", async () => {
    desktop.refreshNativeSurface.mockClear()
    desktop.resetNativeOverlaySurface.mockClear()

    await act(async () => {
      button("Fullscreen").click()
      await Promise.resolve()
    })

    expect(desktop.refreshNativeSurface).not.toHaveBeenCalled()
    expect(desktop.resetNativeOverlaySurface).not.toHaveBeenCalled()
  })

  it("clears transient overlay pixels before manual next-episode playback", async () => {
    const next = vi.fn()
    await act(async () => {
      root.render(
        <DesktopPlayer
          url="https://example.com/video.mp4"
          type="series"
          videoId="series:1:1"
          profileId="00000000-0000-4000-8000-000000000001"
          progressMetadata={{
            mediaType: "series",
            mediaId: "series",
            name: "Test series",
          }}
          addons={[]}
          nextEpisodeLabel="S1 E2"
          onNextEpisode={next}
          onClose={() => undefined}
        />,
      )
      await Promise.resolve()
    })
    act(() => vi.advanceTimersByTime(1))
    desktop.resetNativeOverlaySurface.mockClear()

    click(button("Next episode: S1 E2"))
    act(() => vi.advanceTimersByTime(1))
    act(() => vi.advanceTimersByTime(1))

    expect(next).toHaveBeenCalledOnce()
    expect(desktop.resetNativeOverlaySurface).toHaveBeenCalledOnce()
  })

  it("cycles scaling modes, applies mpv properties, and briefly shows the mode", async () => {
    click(button("Video scale: Fit"))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(desktop.nativePlayerCommand).toHaveBeenCalledWith(["set", "video-unscaled", "no"])
    expect(desktop.nativePlayerCommand).toHaveBeenCalledWith(["set", "keepaspect", "yes"])
    expect(desktop.nativePlayerCommand).toHaveBeenCalledWith(["set", "panscan", 1])
    expect(button("Video scale: Crop")).toBeTruthy()
    expect(document.querySelector('[role="status"]')?.textContent).toBe("Video scale: Crop")

    desktop.resetNativeOverlaySurface.mockClear()
    act(() => vi.advanceTimersByTime(1400))
    act(() => vi.advanceTimersByTime(1))
    act(() => vi.advanceTimersByTime(1))
    expect(document.querySelector('[role="status"]')).toBeNull()
    expect(desktop.resetNativeOverlaySurface).toHaveBeenCalledTimes(2)
  })

  it("hides inactive controls and cursor, then restores them on mouse movement", () => {
    const player = document.querySelector<HTMLElement>(".native-player")
    const chrome = document.querySelectorAll<HTMLElement>("[data-player-chrome]")
    desktop.resetNativeOverlaySurface.mockClear()

    act(() => vi.advanceTimersByTime(2800))
    act(() => vi.advanceTimersByTime(1))

    expect(player?.className).toContain("cursor-none")
    for (const region of chrome) expect(region.classList.contains("invisible")).toBe(true)
    expect(desktop.resetNativeOverlaySurface).toHaveBeenCalledOnce()

    act(() => {
      player?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))
    })

    expect(player?.className).toContain("cursor-default")
    for (const region of chrome) expect(region.classList.contains("visible")).toBe(true)
  })

  it("coalesces continuous timeline changes into one exact seek", () => {
    const seek = document.querySelector<HTMLInputElement>('input[aria-label="Seek"]')
    expect(seek).not.toBeNull()
    desktop.nativePlayerCommand.mockClear()

    act(() => {
      changeRange(seek!, 20)
      changeRange(seek!, 45)
      changeRange(seek!, 70)
    })

    expect(desktop.nativePlayerCommand).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(179))
    expect(desktop.nativePlayerCommand).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(desktop.nativePlayerCommand).toHaveBeenCalledTimes(1)
    expect(desktop.nativePlayerCommand).toHaveBeenCalledWith(["seek", 70, "absolute+exact"])
  })

  it("places separate elapsed and duration labels around the timeline", () => {
    const seek = document.querySelector<HTMLInputElement>('input[aria-label="Seek"]')
    const elapsed = document.querySelector<HTMLElement>('[aria-label="Elapsed time"]')
    const duration = document.querySelector<HTMLElement>(
      '[aria-label="End time. Click to show time remaining."]',
    )

    expect(elapsed?.textContent).toBe("0:10")
    expect(duration?.textContent).toBe("1:40")
    expect(elapsed?.className).toContain("text-sm")
    expect(duration?.className).toContain("text-sm")
    expect(elapsed?.parentElement).toBe(seek?.parentElement)
    expect(duration?.parentElement).toBe(seek?.parentElement)
    expect(document.querySelector('button[aria-label="Back 10 seconds"]')).toBeNull()
    expect(document.querySelector('button[aria-label="Forward 10 seconds"]')).toBeNull()
  })

  it("toggles the right playback time between duration and time remaining", () => {
    const endTime = document.querySelector<HTMLButtonElement>(
      '[aria-label="End time. Click to show time remaining."]',
    )
    expect(endTime?.textContent).toBe("1:40")

    click(endTime!)

    expect(endTime?.textContent).toBe("-1:30")
    expect(endTime?.getAttribute("aria-label")).toBe(
      "Time remaining. Click to show end time.",
    )

    click(endTime!)
    expect(endTime?.textContent).toBe("1:40")
  })

  it("commits the latest timeline position immediately on pointer release", () => {
    const seek = document.querySelector<HTMLInputElement>('input[aria-label="Seek"]')
    expect(seek).not.toBeNull()
    desktop.nativePlayerCommand.mockClear()

    act(() => {
      changeRange(seek!, 55)
      seek!.dispatchEvent(new Event("pointerup", { bubbles: true }))
    })

    expect(desktop.nativePlayerCommand).toHaveBeenCalledTimes(1)
    expect(desktop.nativePlayerCommand).toHaveBeenCalledWith(["seek", 55, "absolute+exact"])
    act(() => vi.advanceTimersByTime(500))
    expect(desktop.nativePlayerCommand).toHaveBeenCalledTimes(1)
  })

  it("keeps play/pause visible while seeking", () => {
    const seek = document.querySelector<HTMLInputElement>('input[aria-label="Seek"]')
    expect(seek).not.toBeNull()
    const playPause = button("Pause")

    act(() => {
      changeRange(seek!, 55)
    })
    expect(playPause.parentElement?.className).not.toContain("invisible")

    act(() => {
      seek!.dispatchEvent(new Event("pointerup", { bubbles: true }))
    })
    expect(playPause.parentElement?.className).not.toContain("invisible")
  })

  it("unmounts the menu when its trigger is clicked again", () => {
    click(button("Audio: English"))
    click(button("Audio: English"))

    expect(document.querySelector('[role="menu"]')).toBeNull()
  })

  it("replaces and clears the previous track menu when switching menus", () => {
    click(button("Audio: English"))
    expect(document.querySelector('[role="menu"]')?.textContent).toContain("Audio")
    desktop.resetNativeOverlaySurface.mockClear()

    click(button("Subtitles: Off"))
    act(() => vi.advanceTimersByTime(1))
    act(() => vi.advanceTimersByTime(1))

    const menus = document.querySelectorAll('[role="menu"]')
    expect(menus).toHaveLength(1)
    expect(menus[0]?.textContent).toContain("Subtitles")
    expect(menus[0]?.textContent).not.toContain("Commentary")
    expect(desktop.resetNativeOverlaySurface).toHaveBeenCalledOnce()
  })

  it("unmounts the menu when a pointer gesture starts outside it", () => {
    click(button("Audio: English"))

    act(() => {
      const player = document.querySelector(".native-player")
      player?.dispatchEvent(new Event("pointerdown", { bubbles: true }))
      player?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(document.querySelector('[role="menu"]')).toBeNull()
  })

  it("applies a selected track and keeps the updated menu open", async () => {
    click(button("Audio: English"))

    await act(async () => {
      button("Commentary").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(desktop.nativePlayerCommand).toHaveBeenCalledWith(["set", "aid", 2])
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    expect(button("Commentary").className).toContain("bg-amber-400")
    expect(button("English").className).not.toContain("bg-amber-400")
  })

  it("applies a selected subtitle and keeps the updated menu open", async () => {
    click(button("Subtitles: Off"))
    click(button("Spanish"))
    const variant = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .filter((candidate) => candidate.textContent?.includes("Spanish"))
      .at(-1)
    expect(variant).toBeDefined()

    await act(async () => {
      variant?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(desktop.nativePlayerCommand).toHaveBeenCalledWith(["set", "sid", 3])
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    expect(variant?.className).toContain("bg-amber-400")
    expect(button("Off").className).not.toContain("bg-amber-400")
  })

  it("does not show an add-on subtitle again after mpv exposes it as an external track", () => {
    const subtitles = [
      { key: "one", display: "English · AIOStreams" },
      { key: "two", display: "Spanish · AIOStreams" },
    ]
    const tracks = [
      { external: true, title: "English · AIOStreams" },
      { external: false, title: "Spanish · AIOStreams" },
    ]

    expect(filterAddedAddonSubtitles(subtitles, tracks)).toEqual([subtitles[1]])
  })

  it("removes duplicate add-on subtitle labels before the menu is shown", () => {
    const subtitles = [
      { key: "one", display: "English · AIOStreams" },
      { key: "two", display: "English · AIOStreams" },
      { key: "three", display: "Spanish · AIOStreams" },
    ]

    expect(dedupeAddonSubtitles(subtitles)).toEqual([subtitles[0], subtitles[2]])
  })
})

describe("native playback completion", () => {
  it("detects mpv clearing its timeline immediately after EOF", () => {
    expect(
      nativePlaybackEnded(
        { ...snapshot, position: 99, duration: 100, ended: false },
        { ...snapshot, position: 0, duration: 0, ended: false },
      ),
    ).toBe(true)
  })

  it("does not treat an uninitialized timeline as EOF", () => {
    expect(
      nativePlaybackEnded(undefined, { ...snapshot, position: 0, duration: 0, ended: false }),
    ).toBe(false)
  })
})

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label || candidate.textContent?.includes(label),
  )
  if (!(match instanceof HTMLButtonElement)) {
    const available = [...document.querySelectorAll("button")].map(
      (candidate) => candidate.getAttribute("aria-label") ?? candidate.textContent?.trim(),
    )
    throw new Error(`Could not find button "${label}". Available: ${available.join(", ")}`)
  }
  return match
}

function click(target: HTMLButtonElement): void {
  act(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

function changeRange(target: HTMLInputElement, value: number): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(target, String(value))
  target.dispatchEvent(new Event("input", { bubbles: true }))
}
