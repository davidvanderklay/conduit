import { trackLanguageCode } from "./languages"

export interface SubtitleLanguageGroup<T> {
  code: string
  label: string
  tracks: T[]
}

/** Group key for a track's language tag or title; "und" when neither names a language. */
export function normalizeSubtitleLanguage(value?: string): string {
  return trackLanguageCode(value, value) ?? "und"
}

export function subtitleLanguageName(code: string): string {
  if (code === "und") return "Unknown language"
  try {
    return new Intl.DisplayNames([navigator.language], { type: "language" }).of(code) ?? code
  } catch {
    return code
  }
}

export function groupSubtitles<T>(
  tracks: T[],
  languageOf: (track: T) => string | undefined,
  preferredLanguage?: string,
): SubtitleLanguageGroup<T>[] {
  const groups = new Map<string, T[]>()
  for (const track of tracks) {
    const code = normalizeSubtitleLanguage(languageOf(track))
    groups.set(code, [...(groups.get(code) ?? []), track])
  }
  const preferred = normalizeSubtitleLanguage(preferredLanguage)
  return [...groups]
    .map(([code, items]) => ({ code, label: subtitleLanguageName(code), tracks: items }))
    .sort((left, right) => {
      if (left.code === preferred && right.code !== preferred) return -1
      if (right.code === preferred && left.code !== preferred) return 1
      if (left.code === "und") return 1
      if (right.code === "und") return -1
      return left.label.localeCompare(right.label)
    })
}
