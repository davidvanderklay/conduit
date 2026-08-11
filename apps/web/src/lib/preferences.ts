export type ThemePreference = "dark" | "system"
export type ResumeBehavior = "ask" | "always" | "restart"

export interface DevicePreferences {
  audioLanguage: string
  subtitleLanguage: string
  subtitleSize: number
  subtitlePosition: number
  readAheadSeconds: number
  autoSelectSavedStreams: boolean
  autoplay: boolean
  volume: number
  hardwareAcceleration: boolean
  resumeBehavior: ResumeBehavior
  theme: ThemePreference
  reducedMotion: boolean
  amoledBlack: boolean
  subtitleOutline: boolean
  rememberLastProfile: boolean
  debugLogging: boolean
}

const KEY = "conduit.device-preferences.v1"

export const defaultPreferences: DevicePreferences = {
  audioLanguage: "en",
  subtitleLanguage: "en",
  subtitleSize: 100,
  subtitlePosition: 90,
  readAheadSeconds: 30,
  autoSelectSavedStreams: true,
  autoplay: true,
  volume: 100,
  hardwareAcceleration: true,
  resumeBehavior: "ask",
  theme: "dark",
  reducedMotion: false,
  amoledBlack: false,
  subtitleOutline: true,
  rememberLastProfile: true,
  debugLogging: false,
}

export function readPreferences(storage: Storage = localStorage): DevicePreferences {
  try {
    const value = JSON.parse(storage.getItem(KEY) ?? "{}") as Partial<DevicePreferences>
    return {
      ...defaultPreferences,
      ...value,
      subtitleSize: clamp(Number(value.subtitleSize ?? defaultPreferences.subtitleSize), 75, 200),
      subtitlePosition: clamp(
        Number(value.subtitlePosition ?? defaultPreferences.subtitlePosition),
        10,
        100,
      ),
      readAheadSeconds: clamp(
        Number(value.readAheadSeconds ?? defaultPreferences.readAheadSeconds),
        10,
        120,
      ),
      volume: clamp(Number(value.volume ?? defaultPreferences.volume), 0, 100),
    }
  } catch {
    return { ...defaultPreferences }
  }
}

export function writePreferences(
  preferences: DevicePreferences,
  storage: Storage = localStorage,
): void {
  storage.setItem(KEY, JSON.stringify(preferences))
  applyPreferences(preferences)
  window.dispatchEvent(new CustomEvent("conduit:preferences", { detail: preferences }))
}

export function applyPreferences(preferences: DevicePreferences): void {
  document.documentElement.style.setProperty("--subtitle-scale", `${preferences.subtitleSize / 100}`)
  document.documentElement.style.setProperty("--subtitle-position", `${preferences.subtitlePosition}%`)
  document.documentElement.classList.toggle("reduce-motion", preferences.reducedMotion)
  document.documentElement.classList.toggle("amoled-black", preferences.amoledBlack)
  document.documentElement.classList.toggle("subtitle-outline", preferences.subtitleOutline)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
