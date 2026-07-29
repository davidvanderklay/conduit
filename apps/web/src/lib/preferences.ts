export type ThemePreference = "dark" | "system"
export type ResumeBehavior = "ask" | "always" | "restart"

export interface DevicePreferences {
  audioLanguage: string
  subtitleLanguage: string
  subtitleSize: number
  autoplay: boolean
  volume: number
  hardwareAcceleration: boolean
  resumeBehavior: ResumeBehavior
  theme: ThemePreference
  reducedMotion: boolean
}

const KEY = "conduit.device-preferences.v1"

export const defaultPreferences: DevicePreferences = {
  audioLanguage: "en",
  subtitleLanguage: "en",
  subtitleSize: 100,
  autoplay: true,
  volume: 100,
  hardwareAcceleration: true,
  resumeBehavior: "ask",
  theme: "dark",
  reducedMotion: false,
}

export function readPreferences(storage: Storage = localStorage): DevicePreferences {
  try {
    const value = JSON.parse(storage.getItem(KEY) ?? "{}") as Partial<DevicePreferences>
    return {
      ...defaultPreferences,
      ...value,
      subtitleSize: clamp(Number(value.subtitleSize ?? defaultPreferences.subtitleSize), 75, 200),
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
  document.documentElement.classList.toggle("reduce-motion", preferences.reducedMotion)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
