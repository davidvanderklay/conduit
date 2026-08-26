import type { NativeTrack } from "./desktop"
import { normalizeSubtitleLanguage, subtitleLanguageName } from "./subtitle-groups"

export function isTrackSourceLabel(value?: string): boolean {
  const normalized = value?.trim().toLocaleLowerCase()
  return Boolean(
    normalized &&
      (normalized.startsWith("http://") ||
        normalized.startsWith("https://") ||
        normalized.startsWith("www.")),
  )
}

export function trackLanguageName(code?: string): string | undefined {
  if (!code) return undefined
  const normalized = normalizeSubtitleLanguage(code)
  if (normalized === "und") return code
  return subtitleLanguageName(normalized)
}

/** Use the track language when a media source exposes its URL as the title. */
export function trackDisplayName(track: NativeTrack, fallback: string): string {
  const title = track.title?.trim()
  if (title && !isTrackSourceLabel(title)) return title
  return trackLanguageName(track.lang) ?? track.lang?.trim() ?? fallback
}

export function subtitleVariantName(track: NativeTrack): string {
  const title = track.title?.trim()
  if (track.external) {
    return `${trackDisplayName(track, "Add-on subtitle")} · External`
  }

  if (!title || isTrackSourceLabel(title) || isLanguageOnlyTitle(title, track.lang)) {
    return "Embedded"
  }
  return `${title} · Embedded`
}

function isLanguageOnlyTitle(title: string, language?: string): boolean {
  const titleLanguage = normalizeSubtitleLanguage(title)
  if (titleLanguage === "und") return false
  const trackLanguage = normalizeSubtitleLanguage(language)
  return trackLanguage === "und" || titleLanguage === trackLanguage
}
