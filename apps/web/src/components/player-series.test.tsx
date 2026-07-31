// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Video } from "../lib/core"
import {
  NEXT_EPISODE_COUNTDOWN,
  NextEpisodePrompt,
  shouldShowNextEpisodePrompt,
} from "./player-series"

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const episode: Video = {
  id: "series:3:1",
  season: 3,
  episode: 1,
  title: "A new beginning",
}

describe("next episode prompt", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
  })

  it("only enters the near-end window when a next episode exists", () => {
    expect(shouldShowNextEpisodePrompt(54, 100, true)).toBe(false)
    expect(shouldShowNextEpisodePrompt(55, 100, true)).toBe(true)
    expect(shouldShowNextEpisodePrompt(99, 100, false)).toBe(false)
    expect(shouldShowNextEpisodePrompt(100, 100, true)).toBe(false)
  })

  it("counts down once and transitions when autoplay is enabled", () => {
    const watchNow = vi.fn()
    act(() => {
      root.render(
        <NextEpisodePrompt
          seriesName="Example"
          episode={episode}
          position={80}
          duration={100}
          paused={false}
          autoplay
          onDismiss={vi.fn()}
          onWatchNow={watchNow}
        />,
      )
    })
    expect(host.textContent).toContain(`Watch now · ${NEXT_EPISODE_COUNTDOWN}s`)
    act(() => vi.advanceTimersByTime(NEXT_EPISODE_COUNTDOWN * 1000))
    expect(watchNow).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(5000))
    expect(watchNow).toHaveBeenCalledTimes(1)
  })

  it("keeps Watch now available without a countdown when autoplay is disabled", () => {
    const watchNow = vi.fn()
    act(() => {
      root.render(
        <NextEpisodePrompt
          seriesName="Example"
          episode={episode}
          position={80}
          duration={100}
          paused={false}
          autoplay={false}
          onDismiss={vi.fn()}
          onWatchNow={watchNow}
        />,
      )
    })
    expect(host.textContent).toContain("Watch now")
    expect(host.textContent).not.toContain("15s")
    act(() => vi.advanceTimersByTime(30_000))
    expect(watchNow).not.toHaveBeenCalled()
  })

  it("does not reappear after dismissal and seeking", () => {
    const dismiss = vi.fn()
    const renderAt = (position: number) => {
      root.render(
        <NextEpisodePrompt
          seriesName="Example"
          episode={episode}
          position={position}
          duration={100}
          paused={false}
          autoplay
          onDismiss={dismiss}
          onWatchNow={vi.fn()}
        />,
      )
    }
    act(() => renderAt(80))
    const dismissButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Dismiss",
    )
    act(() => dismissButton?.click())
    expect(dismiss).toHaveBeenCalledTimes(1)
    act(() => renderAt(20))
    act(() => renderAt(90))
    expect(host.textContent).not.toContain("Next on Example")
  })
})
