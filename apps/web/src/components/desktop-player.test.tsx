// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DesktopPlayer } from "./desktop-player"

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const snapshot = {
  running: true,
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
          title="Test video"
          type="movie"
          videoId="tt123"
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

  it("unmounts the menu when its trigger is clicked again", () => {
    click(button("Audio: English"))
    click(button("Audio: English"))

    expect(document.querySelector('[role="menu"]')).toBeNull()
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
