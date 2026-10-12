import type { BrowserWindow } from "electron"

const WM_NCLBUTTONDBLCLK = 0x00a3
const HTCAPTION = 2

// Transparent Windows windows suppress native title-bar maximization. Drag
// regions send native messages, so a renderer onDoubleClick cannot handle this.
export function installWindowsTitleBar(
  window: Pick<
    BrowserWindow,
    "hookWindowMessage" | "isMaximized" | "isDestroyed" | "isFullScreen" | "maximize" | "unmaximize"
  >,
) {
  if (process.platform !== "win32") return
  window.hookWindowMessage(WM_NCLBUTTONDBLCLK, (wParam) => {
    if (wParam.readUInt32LE(0) !== HTCAPTION || window.isFullScreen()) return
    const wasMaximized = window.isMaximized()
    // Let native message processing finish first. Capture the original state
    // because Windows may already restore the window while handling the message.
    setImmediate(() => {
      if (window.isDestroyed() || window.isFullScreen()) return
      if (wasMaximized) window.unmaximize()
      else window.maximize()
    })
  })
}
