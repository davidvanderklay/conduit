import type { BrowserWindow } from "electron"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { installWindowsTitleBar } from "./windows-titlebar"

const WM_NCLBUTTONDBLCLK = 0x00a3
const HTCAPTION = 2

function createWindow(maximized = false) {
  const hooks = new Map<number, (wParam: Buffer, lParam: Buffer) => void>()
  const window = {
    hookWindowMessage: vi.fn((message: number, callback: (w: Buffer, l: Buffer) => void) => {
      hooks.set(message, callback)
    }),
    isMaximized: () => maximized,
    isDestroyed: vi.fn(() => false),
    isFullScreen: vi.fn(() => false),
    maximize: vi.fn(() => {
      maximized = true
    }),
    unmaximize: vi.fn(() => {
      maximized = false
    }),
  } satisfies Pick<
    BrowserWindow,
    "hookWindowMessage" | "isMaximized" | "isDestroyed" | "isFullScreen" | "maximize" | "unmaximize"
  >
  function doubleClick(hitTest = HTCAPTION) {
    const wParam = Buffer.alloc(8)
    wParam.writeUInt32LE(hitTest)
    hooks.get(WM_NCLBUTTONDBLCLK)?.(wParam, Buffer.alloc(8))
  }
  return { window, doubleClick }
}

beforeEach(() => {
  vi.stubGlobal("process", { ...process, platform: "win32" })
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it("maximizes and restores a transparent window on title-bar double-click", () => {
  const { window, doubleClick } = createWindow()
  installWindowsTitleBar(window)
  doubleClick()
  vi.runAllTimers()
  expect(window.maximize).toHaveBeenCalledOnce()
  doubleClick()
  vi.runAllTimers()
  expect(window.unmaximize).toHaveBeenCalledOnce()
})

it("does not maximize again if Windows already restored the window", () => {
  const { window, doubleClick } = createWindow(true)
  installWindowsTitleBar(window)
  doubleClick()
  window.unmaximize()
  vi.runAllTimers()
  expect(window.isMaximized()).toBe(false)
  expect(window.maximize).not.toHaveBeenCalled()
})

it("ignores non-caption double-clicks", () => {
  const { window, doubleClick } = createWindow()
  installWindowsTitleBar(window)
  doubleClick(1) // HTCLIENT
  doubleClick(10) // HTLEFT resize border
  vi.runAllTimers()
  expect(window.maximize).not.toHaveBeenCalled()
  expect(window.unmaximize).not.toHaveBeenCalled()
})

it("ignores fullscreen windows and windows closed before the callback runs", () => {
  const { window, doubleClick } = createWindow()
  installWindowsTitleBar(window)
  window.isFullScreen.mockReturnValue(true)
  doubleClick()
  vi.runAllTimers()
  expect(window.maximize).not.toHaveBeenCalled()
  window.isFullScreen.mockReturnValue(false)
  doubleClick()
  window.isDestroyed.mockReturnValue(true)
  vi.runAllTimers()
  expect(window.maximize).not.toHaveBeenCalled()
})

it.each(["linux", "darwin"])("leaves %s title-bar behavior native", (platform) => {
  vi.stubGlobal("process", { ...process, platform })
  const { window } = createWindow()
  installWindowsTitleBar(window)
  expect(window.hookWindowMessage).not.toHaveBeenCalled()
})
