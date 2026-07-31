const languageAliases: Record<string, string> = {
  eng: "en",
  english: "en",
  spa: "es",
  spanish: "es",
  espanol: "es",
  "español": "es",
  fre: "fr",
  fra: "fr",
  french: "fr",
  ger: "de",
  deu: "de",
  german: "de",
  ita: "it",
  italian: "it",
  por: "pt",
  portuguese: "pt",
  dut: "nl",
  nld: "nl",
  jpn: "ja",
  japanese: "ja",
  kor: "ko",
  korean: "ko",
  chi: "zh",
  zho: "zh",
  chinese: "zh",
  rus: "ru",
  russian: "ru",
  ara: "ar",
  arabic: "ar",
  hin: "hi",
  hindi: "hi",
  ind: "id",
  indonesian: "id",
  vie: "vi",
  vietnamese: "vi",
}

export interface SubtitleLanguageGroup<T> {
  code: string
  label: string
  tracks: T[]
}

export function normalizeSubtitleLanguage(value?: string): string {
  const raw = value?.trim()
  if (!raw) return "und"
  const normalized = raw.toLocaleLowerCase().replaceAll("_", "-")
  if (languageAliases[normalized]) return languageAliases[normalized]
  const base = normalized.split("-")[0] ?? normalized
  if (languageAliases[base]) return languageAliases[base]
  if (/^[a-z]{2}$/.test(base)) return base
  try {
    const maximized = new Intl.Locale(normalized).language
    return languageAliases[maximized] ?? maximized
  } catch {
    return "und"
  }
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
