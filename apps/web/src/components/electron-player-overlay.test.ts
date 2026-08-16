// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { defaultSubtitleTrack, ElectronPlayerOverlay } from "./electron-player-overlay"

const desktop = vi.hoisted(() => ({
  invoke: vi.fn(function invoke<T>(_command: string, _args?: unknown): Promise<T> {
    return Promise.resolve(undefined as T)
  }),
  nativePlayerCommand: vi.fn(async () => undefined),
  nativePlayerSnapshot: vi.fn(async () => ({
    running: true,
    ended: false,
    paused: false,
    loading: false,
    firstFrameReady: false,
    position: 0,
    duration: 100,
    bufferedDuration: 0,
    volume: 100,
    playbackPath: "directPlay" as const,
    tracks: [],
  })),
  toggleNativeFullscreen: vi.fn(async () => false),
}))

vi.mock("../lib/desktop", () => desktop)

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

describe("Electron subtitle selection", () => {
  it("prefers an embedded track over a selected external track", () => {
    const external = {
      id: 1,
      type: "sub" as const,
      title: "English · AIOStreams",
      selected: true,
      external: true,
    }
    const embedded = {
      id: 2,
      type: "sub" as const,
      title: "English",
      selected: false,
      external: false,
    }

    expect(defaultSubtitleTrack({
      code: "en",
      label: "English",
      tracks: [external, embedded],
    })).toBe(embedded)
  })

  it("falls back to an external track when there is no embedded option", () => {
    const external = {
      id: 1,
      type: "sub" as const,
      title: "English · AIOStreams",
      selected: false,
      external: true,
    }

    expect(defaultSubtitleTrack({
      code: "en",
      label: "English",
      tracks: [external],
    })).toBe(external)
  })
})

describe("Electron episode drawer", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    window.__CONDUIT_ELECTRON__ = {
      invoke: desktop.invoke as <T>(command: string, args?: unknown) => Promise<T>,
      onFullscreenChange: vi.fn(() => () => undefined),
      onPlayerOverlayClose: vi.fn(() => () => undefined),
      onPlayerOverlayNext: vi.fn(() => () => undefined),
      onPlayerOverlayEpisode: vi.fn(() => () => undefined),
      onPlayerOverlayMedia: vi.fn(() => () => undefined),
      notifyPlayerOverlayReady: vi.fn(),
      setPlayerOverlayInteractiveRegions: vi.fn(),
      onPlayerOverlayWake: vi.fn(() => () => undefined),
      onDesktopAuthCallback: vi.fn(() => () => undefined),
      chooseSavePath: vi.fn(async () => null),
      writeTextFile: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
    }
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    delete window.__CONDUIT_ELECTRON__
    vi.clearAllMocks()
  })

  it("restores the side handle and sends the selected episode to the player", () => {
    act(() => {
      root.render(
        createElement(ElectronPlayerOverlay, {
          initialMedia: {
            title: "Example · S1 E1",
            series: {
              name: "Example",
              videos: [
                { id: "s1e1", season: 1, episode: 1, title: "One" },
                { id: "s1e2", season: 1, episode: 2, title: "Two" },
              ],
              progress: [],
              currentVideoId: "s1e1",
            },
          },
        }),
      )
    })

    const handle = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Open episode list"]',
    )
    expect(handle).not.toBeNull()

    act(() => handle?.click())
    expect(host.querySelector("[data-player-episode-drawer]")).not.toBeNull()

    const nextEpisode = host.querySelector<HTMLButtonElement>('[data-video-id="s1e2"]')
    act(() => nextEpisode?.click())
    expect(desktop.invoke).toHaveBeenCalledWith("player_overlay_episode", { videoId: "s1e2" })
  })
})
