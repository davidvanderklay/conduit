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
  setNativePlayerCursorHidden: vi.fn(async () => undefined),
  setNativePlayerPlaying: vi.fn(async () => undefined),
  toggleNativeFullscreen: vi.fn(async () => false),
}))

vi.mock("../lib/desktop", () => desktop)

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

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

    expect(
      defaultSubtitleTrack({
        code: "en",
        label: "English",
        tracks: [external, embedded],
      }),
    ).toBe(embedded)
  })

  it("falls back to an external track when there is no embedded option", () => {
    const external = {
      id: 1,
      type: "sub" as const,
      title: "English · AIOStreams",
      selected: false,
      external: true,
    }

    expect(
      defaultSubtitleTrack({
        code: "en",
        label: "English",
        tracks: [external],
      }),
    ).toBe(external)
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
    vi.useRealTimers()
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

    const handle = host.querySelector<HTMLButtonElement>('button[aria-label="Open episode list"]')
    expect(handle).not.toBeNull()

    act(() => handle?.click())
    expect(host.querySelector("[data-player-episode-drawer]")).not.toBeNull()

    const nextEpisode = host.querySelector<HTMLButtonElement>('[data-video-id="s1e2"]')
    act(() => nextEpisode?.click())
    expect(desktop.invoke).toHaveBeenCalledWith("player_overlay_episode", { videoId: "s1e2" })

    act(() =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Open episode list"]')?.click(),
    )
    const reopenedEpisode = host.querySelector<HTMLButtonElement>('[data-video-id="s1e2"]')
    act(() => {
      reopenedEpisode?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 120,
          clientY: 120,
        }),
      )
    })
    const markWatched = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].find((button) => button.textContent?.includes("Mark as watched"))
    act(() => markWatched?.click())
    expect(desktop.invoke).toHaveBeenCalledWith("player_overlay_watch_action", {
      videoIds: ["s1e2"],
      watched: true,
    })
  })

  it("shows Up Next above the desktop controls and forwards Play now", async () => {
    vi.useFakeTimers()
    desktop.nativePlayerSnapshot.mockResolvedValue({
      running: true,
      ended: false,
      paused: false,
      loading: false,
      firstFrameReady: true,
      position: 80,
      duration: 100,
      bufferedDuration: 20,
      volume: 80,
      playbackPath: "directPlay",
      tracks: [],
    })

    await act(async () => {
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
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })

    const prompt = host.querySelector<HTMLElement>('[aria-label="Next on Example"]')
    expect(prompt?.parentElement?.className).toContain("bottom-36")
    const playNow = [...(prompt?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (button) => button.textContent?.includes("Watch now"),
    )
    act(() => playNow?.click())
    expect(desktop.invoke).toHaveBeenCalledWith("player_overlay_next")
  })

  it("shows a skip intro action when IntroDB returns an active segment", async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ intro: { start_sec: 30, end_sec: 60 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    )
    desktop.nativePlayerSnapshot.mockResolvedValue({
      running: true,
      ended: false,
      paused: false,
      loading: false,
      firstFrameReady: true,
      position: 40,
      duration: 100,
      bufferedDuration: 20,
      volume: 80,
      playbackPath: "directPlay",
      tracks: [],
    })

    await act(async () => {
      root.render(
        createElement(ElectronPlayerOverlay, {
          initialMedia: {
            title: "Example · S1 E1",
            series: {
              name: "Example",
              mediaId: "tt1234567",
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
      await Promise.resolve()
      await Promise.resolve()
    })

    const skipIntro = host.querySelector<HTMLButtonElement>('button[data-native-overlay]')
    expect(skipIntro?.textContent).toContain("Skip intro")
    expect(skipIntro?.className).toContain("bottom-36")
  })

  it("hides the native cursor when the controls time out", async () => {
    vi.useFakeTimers()
    desktop.nativePlayerSnapshot.mockResolvedValue({
      running: true,
      ended: false,
      paused: false,
      loading: false,
      firstFrameReady: true,
      position: 10,
      duration: 100,
      bufferedDuration: 30,
      volume: 80,
      playbackPath: "directPlay",
      tracks: [],
    })

    await act(async () => {
      root.render(
        createElement(ElectronPlayerOverlay, {
          initialMedia: { title: "Example" },
        }),
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => vi.advanceTimersByTime(2801))

    expect(desktop.setNativePlayerCursorHidden).toHaveBeenLastCalledWith(true)
  })

  it("keeps the duration toggle inside Electron's interactive overlay regions", async () => {
    vi.useFakeTimers()
    desktop.nativePlayerSnapshot.mockResolvedValue({
      running: true,
      ended: false,
      paused: false,
      loading: false,
      firstFrameReady: true,
      position: 10,
      duration: 100,
      bufferedDuration: 30,
      volume: 80,
      playbackPath: "directPlay",
      tracks: [],
    })

    await act(async () => {
      root.render(createElement(ElectronPlayerOverlay, { initialMedia: { title: "Example" } }))
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })

    const duration = host.querySelector<HTMLButtonElement>(
      'button[aria-label="End time. Click to show time remaining."]',
    )
    expect(duration?.hasAttribute("data-overlay-interactive")).toBe(true)
    expect(duration?.className).toContain("pointer-events-auto")
    act(() => duration?.click())
    expect(
      host.querySelector('button[aria-label="Time remaining. Click to show end time."]'),
    ).not.toBeNull()
  })
})
