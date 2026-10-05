import { coreValue } from "./core"

export interface PlaybackLanguage {
  /** Stable code stored in preferences. */
  code: string
  name: string
}

/** Languages offered by the preferred audio and subtitle pickers, shared with the mobile apps. */
export function playbackLanguages(): PlaybackLanguage[] {
  return coreValue({ type: "playbackLanguages" })
}

/**
 * Canonical code for a preference or a track. Accepts two- and three-letter
 * codes, locale tags, and language names; falls back to the track label when
 * the language tag says nothing.
 */
export function trackLanguageCode(language?: string, label?: string): string | undefined {
  return coreValue<string | null>({ type: "languageCode", language, label }) ?? undefined
}
