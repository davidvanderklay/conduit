import { contextBridge, ipcRenderer } from "electron"

if (process.platform === "darwin") {
  window.addEventListener("DOMContentLoaded", () => {
    document.documentElement.classList.add("electron-macos")
  })
}

if (process.platform === "win32") {
  window.addEventListener("DOMContentLoaded", () => {
    document.documentElement.classList.add("electron-windows")
  })
}

ipcRenderer.on("conduit:fullscreen-changed", (_event, fullscreen: boolean) => {
  document.documentElement.classList.toggle("electron-native-fullscreen", fullscreen)
})

contextBridge.exposeInMainWorld("__CONDUIT_ELECTRON__", {
  invoke(command: string, args?: unknown) {
    return ipcRenderer.invoke("conduit:invoke", command, args)
  },
  onFullscreenChange(listener: (fullscreen: boolean) => void) {
    const handler = (_event: Electron.IpcRendererEvent, fullscreen: boolean) => {
      listener(fullscreen)
    }
    ipcRenderer.on("conduit:fullscreen-changed", handler)
    return () => ipcRenderer.removeListener("conduit:fullscreen-changed", handler)
  },
  onPlayerOverlayClose(listener: () => void) {
    const handler = () => listener()
    ipcRenderer.on("conduit:player-overlay-close", handler)
    return () => ipcRenderer.removeListener("conduit:player-overlay-close", handler)
  },
  onPlayerOverlayNext(listener: () => void) {
    const handler = () => listener()
    ipcRenderer.on("conduit:player-overlay-next", handler)
    return () => ipcRenderer.removeListener("conduit:player-overlay-next", handler)
  },
  onPlayerOverlayWatchParty(listener: () => void) {
    const handler = () => listener()
    ipcRenderer.on("conduit:player-overlay-watch-party", handler)
    return () => ipcRenderer.removeListener("conduit:player-overlay-watch-party", handler)
  },
  onPlayerOverlayTitle(listener: (title: string) => void) {
    const handler = (_event: Electron.IpcRendererEvent, title: string) => listener(title)
    ipcRenderer.on("conduit:player-overlay-title", handler)
    return () => ipcRenderer.removeListener("conduit:player-overlay-title", handler)
  },
  setPlayerOverlayInteractiveRegions(
    regions: Array<{ left: number; top: number; right: number; bottom: number }>,
  ) {
    ipcRenderer.send("conduit:player-overlay-interactive-regions", regions)
  },
  onPlayerOverlayWake(listener: () => void) {
    const handler = () => listener()
    ipcRenderer.on("conduit:player-overlay-wake", handler)
    return () => ipcRenderer.removeListener("conduit:player-overlay-wake", handler)
  },
  onDesktopAuthCallback(listener: (callbackUrl: string) => void) {
    const handler = (_event: Electron.IpcRendererEvent, callbackUrl: string) => {
      listener(callbackUrl)
    }
    ipcRenderer.on("conduit:desktop-auth-callback", handler)
    return () => ipcRenderer.removeListener("conduit:desktop-auth-callback", handler)
  },
  chooseSavePath(suggestedName: string) {
    return ipcRenderer.invoke("conduit:choose-save-path", suggestedName) as Promise<string | null>
  },
  writeTextFile(path: string, contents: string) {
    return ipcRenderer.invoke("conduit:write-text-file", path, contents) as Promise<void>
  },
  openExternal(url: string) {
    return ipcRenderer.invoke("conduit:open-external", url) as Promise<void>
  },
})
