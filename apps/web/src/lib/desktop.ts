export interface NativeTrack {
  id: number
  type: "audio" | "video" | "sub"
  title?: string
  lang?: string
  codec?: string
  selected: boolean
  external: boolean
}

export interface NativePlayerSnapshot {
  running: boolean
  ended: boolean
  paused: boolean
  loading: boolean
  position: number
  duration: number
  bufferedDuration: number
  volume: number
  title?: string
  tracks: NativeTrack[]
  playbackPath: "directPlay"
  container?: string
  videoCodec?: string
  audioCodec?: string
  hardwareDecoder?: string
}

export interface ElectronDesktopBridge {
  invoke<T>(command: string, args?: unknown): Promise<T>
  onFullscreenChange(listener: (fullscreen: boolean) => void): () => void
  onPlayerOverlayClose(listener: () => void): () => void
  onPlayerOverlayNext(listener: () => void): () => void
  onPlayerOverlayTitle(listener: (title: string) => void): () => void
  setPlayerOverlayInteractiveRegions(
    regions: Array<{ left: number; top: number; right: number; bottom: number }>,
  ): void
  onPlayerOverlayWake(listener: () => void): () => void
  onDesktopAuthCallback(listener: (callbackUrl: string) => void): () => void
  chooseSavePath(suggestedName: string): Promise<string | null>
  writeTextFile(path: string, contents: string): Promise<void>
  openExternal(url: string): Promise<void>
}

declare global {
  interface Window {
    __CONDUIT_ELECTRON__?: ElectronDesktopBridge
  }
}

export function isDesktop(): boolean {
  return "__TAURI_INTERNALS__" in window || window.__CONDUIT_ELECTRON__ !== undefined
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const electron = window.__CONDUIT_ELECTRON__
  if (electron) return electron.invoke<T>(command, args)
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core")
  return tauriInvoke<T>(command, args)
}

export function openNativePlayer(
  url: string,
  title: string,
  readAheadSeconds: number,
  hardwareAcceleration: boolean,
): Promise<NativePlayerSnapshot> {
  return invoke("player_open", { url, title, readAheadSeconds, hardwareAcceleration })
}

export function nativePlayerSnapshot(): Promise<NativePlayerSnapshot> {
  return invoke("player_snapshot")
}

export function nativePlayerCommand(command: unknown[]): Promise<unknown> {
  return invoke("player_command", { command })
}

export function stopNativePlayer(): Promise<void> {
  return invoke("player_stop")
}

export function refreshNativeSurface(): Promise<void> {
  return invoke("player_refresh_surface")
}

export function redrawNativeSurface(): Promise<void> {
  return invoke("player_redraw_surface")
}

export function resetNativeOverlaySurface(): Promise<void> {
  return invoke("player_reset_overlay_surface")
}

export function toggleNativeFullscreen(): Promise<boolean> {
  return invoke("player_toggle_fullscreen")
}

export function nativeFullscreen(): Promise<boolean> {
  return invoke("player_is_fullscreen")
}

export async function onNativeFullscreenChange(
  listener: (fullscreen: boolean) => void,
): Promise<() => void> {
  const electron = window.__CONDUIT_ELECTRON__
  if (electron) return electron.onFullscreenChange(listener)
  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  const nativeWindow = getCurrentWindow()
  return nativeWindow.onResized(async () => listener(await nativeWindow.isFullscreen()))
}

export async function prepareNativeTextSave(
  suggestedName: string,
): Promise<((contents: string) => Promise<void>) | null> {
  const electron = window.__CONDUIT_ELECTRON__
  if (electron) {
    const path = await electron.chooseSavePath(suggestedName)
    return path ? (contents) => electron.writeTextFile(path, contents) : null
  }
  const [{ save }, { writeTextFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ])
  const path = await save({
    defaultPath: suggestedName,
    filters: [{ name: "conduit profile export", extensions: ["json"] }],
  })
  if (!path) return null
  return (contents) => writeTextFile(path, contents)
}
