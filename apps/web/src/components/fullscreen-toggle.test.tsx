// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FullscreenToggle } from "./fullscreen-toggle"

const desktop = vi.hoisted(() => ({
  isDesktop: vi.fn(() => false),
  nativeFullscreen: vi.fn(async () => false),
  onNativeFullscreenChange: vi.fn<
    (listener: (fullscreen: boolean) => void) => Promise<() => void>
  >(async () => () => undefined),
  toggleNativeFullscreen: vi.fn(async () => true),
}))

vi.mock("../lib/desktop", () => desktop)

describe("FullscreenToggle", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    desktop.isDesktop.mockReturnValue(false)
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
      writable: true,
    })
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: vi.fn(async () => undefined),
    })
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: vi.fn(async () => undefined),
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it("toggles browser fullscreen and follows fullscreenchange events", async () => {
    await act(async () => root.render(<FullscreenToggle />))
    const button = container.querySelector("button")!

    expect(button.getAttribute("aria-label")).toBe("Enter fullscreen")
    button.click()
    expect(document.documentElement.requestFullscreen).toHaveBeenCalled()

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.documentElement,
    })
    await act(async () => document.dispatchEvent(new Event("fullscreenchange")))
    expect(button.getAttribute("aria-label")).toBe("Exit fullscreen")

    button.click()
    expect(document.exitFullscreen).toHaveBeenCalled()
  })

  it("uses the native window and follows externally triggered changes on desktop", async () => {
    desktop.isDesktop.mockReturnValue(true)
    let notify: ((fullscreen: boolean) => void) | undefined
    desktop.onNativeFullscreenChange.mockImplementation(async (listener) => {
      notify = listener
      return () => undefined
    })

    await act(async () => root.render(<FullscreenToggle />))
    const button = container.querySelector("button")!
    await act(async () => notify?.(true))
    expect(button.getAttribute("aria-label")).toBe("Exit fullscreen")

    await act(async () => button.click())
    expect(desktop.toggleNativeFullscreen).toHaveBeenCalledOnce()
  })
})
