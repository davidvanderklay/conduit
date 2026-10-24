/** Player actions reachable from the keyboard. Each player maps them onto its own backend. */
export type PlayerShortcut =
  | { type: "toggle-playback" }
  | { type: "seek"; seconds: number }
  | { type: "volume"; delta: number }
  | { type: "mute" }
  | { type: "fullscreen" }
  | { type: "toggle-subtitles" }
  | { type: "menu"; menu: "audio" | "subtitles" }
  | { type: "speed"; delta: number }
  | { type: "next" }

export const SEEK_SECONDS = 10
export const LONG_SEEK_SECONDS = 30
/** Volume step in percent. */
export const VOLUME_STEP = 5
export const SPEED_STEP = 0.25
const MIN_SPEED = 0.25
const MAX_SPEED = 2

type ShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey" | "target"
>

/**
 * Maps a keydown to a player action, following Stremio's bindings. Returns
 * undefined for unbound keys, browser chords, and keys meant for a focused field.
 */
export function playerShortcut(event: ShortcutEvent): PlayerShortcut | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined
  const target = event.target
  if (target instanceof HTMLElement && acceptsText(target)) return undefined
  // Focused sliders keep their native arrow-key stepping.
  const slider = target instanceof HTMLInputElement && target.type === "range"
  const seek = event.shiftKey ? LONG_SEEK_SECONDS : SEEK_SECONDS
  switch (event.key.length === 1 ? event.key.toLowerCase() : event.key) {
    case " ":
    case "k":
      return { type: "toggle-playback" }
    case "ArrowLeft":
      return slider ? undefined : { type: "seek", seconds: -seek }
    case "ArrowRight":
      return slider ? undefined : { type: "seek", seconds: seek }
    case "ArrowUp":
      return slider ? undefined : { type: "volume", delta: VOLUME_STEP }
    case "ArrowDown":
      return slider ? undefined : { type: "volume", delta: -VOLUME_STEP }
    case "m":
      return { type: "mute" }
    case "f":
      return { type: "fullscreen" }
    case "c":
      return { type: "toggle-subtitles" }
    case "s":
      return { type: "menu", menu: "subtitles" }
    case "a":
      return { type: "menu", menu: "audio" }
    case "[":
      return { type: "speed", delta: -SPEED_STEP }
    case "]":
      return { type: "speed", delta: SPEED_STEP }
    case "n":
      return event.shiftKey ? { type: "next" } : undefined
    default:
      return undefined
  }
}

function acceptsText(element: HTMLElement): boolean {
  if (element.isContentEditable) return true
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true
  return (
    element instanceof HTMLInputElement &&
    !["range", "checkbox", "radio", "button", "submit", "reset"].includes(element.type)
  )
}

/** Validates a shortcut forwarded across the Electron IPC boundary. */
export function parsePlayerShortcut(value: unknown): PlayerShortcut | undefined {
  if (!value || typeof value !== "object" || !("type" in value)) return undefined
  const shortcut = value as Record<string, unknown>
  switch (shortcut.type) {
    case "toggle-playback":
    case "mute":
    case "fullscreen":
    case "toggle-subtitles":
    case "next":
      return { type: shortcut.type }
    case "seek":
      return Number.isFinite(shortcut.seconds)
        ? { type: "seek", seconds: shortcut.seconds as number }
        : undefined
    case "volume":
    case "speed":
      return Number.isFinite(shortcut.delta)
        ? { type: shortcut.type, delta: shortcut.delta as number }
        : undefined
    case "menu":
      return shortcut.menu === "audio" || shortcut.menu === "subtitles"
        ? { type: "menu", menu: shortcut.menu }
        : undefined
    default:
      return undefined
  }
}

/** Steps playback speed within Stremio's 0.25×–2× range. */
export function steppedSpeed(current: number, delta: number): number {
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round((current + delta) * 100) / 100))
}

/** Steps a 0–100 volume. */
export function steppedVolume(current: number, delta: number): number {
  return Math.min(100, Math.max(0, Math.round(current + delta)))
}
