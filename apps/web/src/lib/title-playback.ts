import type { DevicePreferences } from "./preferences"
import { trackLanguageCode } from "./languages"

/**
 * Stored subtitle choice for a title watched with subtitles off. No language
 * code resolves from it, so subtitle selection turns subtitles off.
 */
export const SUBTITLES_OFF = "none"

/**
 * Track languages a profile last picked for one title. They apply ahead of the
 * global language preferences, so a series keeps its audio and subtitles
 * across episodes and sources. Missing fields fall back to the global preference.
 */
export interface TitlePlaybackChoices {
  audioLanguage?: string
  /** Language code, or {@link SUBTITLES_OFF}. */
  subtitleLanguage?: string
  /** Positive values show subtitles later. */
  subtitleDelayMs?: number
}

/** One press of a delay control. */
export const SUBTITLE_DELAY_STEP_MS = 100
const SUBTITLE_DELAY_LIMIT_MS = 30_000

const KEY = "conduit.title-playback.v1"
const TITLE_LIMIT = 500

export function readTitlePlayback(
  profileId: string,
  mediaId: string,
  storage: Storage = localStorage,
): TitlePlaybackChoices {
  return readAll(storage)[titleKey(profileId, mediaId)] ?? {}
}

/** Merges the defined fields of `choice` into the title's stored choices. */
export function rememberTitlePlayback(
  profileId: string,
  mediaId: string,
  choice: TitlePlaybackChoices,
  storage: Storage = localStorage,
): void {
  if (!choice.audioLanguage && !choice.subtitleLanguage && choice.subtitleDelayMs === undefined)
    return
  const { [titleKey(profileId, mediaId)]: current, ...others } = readAll(storage)
  // Insertion order tracks recency, so the oldest titles come first.
  const entries = [
    ...Object.entries(others),
    [titleKey(profileId, mediaId), { ...current, ...definedFields(choice) }] as const,
  ].slice(-TITLE_LIMIT)
  storage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)))
}

/** The choice to remember after a manual audio pick. Tracks without a recognizable language are not remembered. */
export function audioChoice(language?: string, label?: string): TitlePlaybackChoices {
  return { audioLanguage: trackLanguageCode(language, label) }
}

/** The choice to remember after a manual subtitle pick, or after turning subtitles off. */
export function subtitleChoice(
  track: { language?: string; label?: string } | "off",
): TitlePlaybackChoices {
  return {
    subtitleLanguage:
      track === "off" ? SUBTITLES_OFF : trackLanguageCode(track.language, track.label),
  }
}

/** The delay after one press of a delay control, kept within ±30 s. */
export function stepSubtitleDelay(delayMs: number, stepMs: number): number {
  const next = Math.round((delayMs + stepMs) / 100) * 100
  return Math.max(-SUBTITLE_DELAY_LIMIT_MS, Math.min(SUBTITLE_DELAY_LIMIT_MS, next))
}

/**
 * The delay after a sync by ear: the subtitle appeared at playback position
 * `sawMs` for a line heard at `heardMs`, so it moves by the gap between them.
 */
export function syncByEarDelay(delayMs: number, heardMs: number, sawMs: number): number {
  return stepSubtitleDelay(delayMs, heardMs - sawMs)
}

/** Holding a delay control repeats it, with larger steps after the first second and a half. */
export function heldSubtitleDelayStep(heldMs: number): number {
  return heldMs < 1500 ? SUBTITLE_DELAY_STEP_MS : SUBTITLE_DELAY_STEP_MS * 5
}

export function formatSubtitleDelay(delayMs: number): string {
  const seconds = (Math.abs(delayMs) / 1000).toFixed(1)
  return delayMs > 0 ? `+${seconds}s` : delayMs < 0 ? `−${seconds}s` : `${seconds}s`
}

type TitleLanguagePreferences = Pick<
  DevicePreferences,
  "audioLanguage" | "subtitleLanguage" | "secondarySubtitleLanguage" | "forcedSubtitlesOnly"
>

/**
 * A remembered subtitle language goes first and the global primary becomes its
 * fallback. Off has no fallback. A remembered subtitle pick also overrides
 * forced-only mode, so a title the viewer watches with full subtitles keeps them.
 */
export function titleLanguagePreferences(
  preferences: TitleLanguagePreferences,
  choices: TitlePlaybackChoices,
): TitleLanguagePreferences {
  return {
    audioLanguage: choices.audioLanguage ?? preferences.audioLanguage,
    subtitleLanguage: choices.subtitleLanguage ?? preferences.subtitleLanguage,
    secondarySubtitleLanguage:
      choices.subtitleLanguage === undefined
        ? preferences.secondarySubtitleLanguage
        : choices.subtitleLanguage === SUBTITLES_OFF
          ? null
          : preferences.subtitleLanguage,
    forcedSubtitlesOnly: preferences.forcedSubtitlesOnly && choices.subtitleLanguage === undefined,
  }
}

function readAll(storage: Storage): Record<string, TitlePlaybackChoices> {
  try {
    const value: unknown = JSON.parse(storage.getItem(KEY) ?? "{}")
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, TitlePlaybackChoices>)
      : {}
  } catch {
    return {}
  }
}

function definedFields(choice: TitlePlaybackChoices): TitlePlaybackChoices {
  return Object.fromEntries(Object.entries(choice).filter(([, value]) => value !== undefined))
}

function titleKey(profileId: string, mediaId: string): string {
  return `${profileId}:${mediaId}`
}
