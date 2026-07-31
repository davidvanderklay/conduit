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
  position: number
  duration: number
  volume: number
  title?: string
  tracks: NativeTrack[]
}

export function isDesktop(): boolean {
  return "__TAURI_INTERNALS__" in window
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core")
  return tauriInvoke<T>(command, args)
}

export function openNativePlayer(url: string, title: string): Promise<NativePlayerSnapshot> {
  return invoke("player_open", { url, title })
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
  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  const window = getCurrentWindow()
  return window.onResized(async () => listener(await window.isFullscreen()))
}

export async function prepareNativeTextSave(
  suggestedName: string,
): Promise<((contents: string) => Promise<void>) | null> {
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
