// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SubtitleSyncByEar } from "./subtitle-sync-by-ear"

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe("SubtitleSyncByEar", () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it("shifts the delay by the gap between the two taps, in either order", async () => {
    const positions = [10_000, 11_200, 30_000, 30_400]
    const onDelayChange = vi.fn()
    act(() =>
      root.render(
        <SubtitleSyncByEar
          delayMs={0}
          onDelayChange={onDelayChange}
          positionMs={() => positions.shift()!}
          onClose={() => undefined}
        />,
      ),
    )
    const button = (name: string) =>
      [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === name)!

    await act(async () => button("Heard").click())
    expect(button("Heard").getAttribute("aria-pressed")).toBe("true")
    expect(onDelayChange).not.toHaveBeenCalled()
    await act(async () => button("Saw").click())
    expect(onDelayChange).toHaveBeenLastCalledWith(-1200)
    expect(button("Heard").getAttribute("aria-pressed")).toBe("false")

    await act(async () => button("Saw").click())
    await act(async () => button("Heard").click())
    expect(onDelayChange).toHaveBeenLastCalledWith(400)
  })
})
