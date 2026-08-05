import { contextBridge, ipcRenderer } from "electron"

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
