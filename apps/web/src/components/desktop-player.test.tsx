// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  DesktopPlayer,
  dedupeAddonSubtitles,
  filterAddedAddonSubtitles,
  nativePlaybackEnded,
  usesExpandedPlayerControls,
} from "./desktop-player"

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const snapshot = {
  running: true,
  ended: false,
  paused: false,
  position: 10,
  duration: 100,
  volume: 80,
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

    await act(async () => {
      button("Spanish").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(desktop.nativePlayerCommand).toHaveBeenCalledWith(["set", "sid", 3])
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    expect(button("Spanish").className).toContain("bg-amber-400")
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
    expect(nativePlaybackEnded(
      { ...snapshot, position: 99, duration: 100, ended: false },
      { ...snapshot, position: 0, duration: 0, ended: false },
    )).toBe(true)
  })

  it("does not treat an uninitialized timeline as EOF", () => {
    expect(nativePlaybackEnded(
      undefined,
      { ...snapshot, position: 0, duration: 0, ended: false },
    )).toBe(false)
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
