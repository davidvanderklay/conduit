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

export function toggleNativeFullscreen(): Promise<boolean> {
  return invoke("player_toggle_fullscreen")
}
