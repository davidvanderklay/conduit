const ISO_639_ALIASES: Record<string, string> = {
  eng: "en",
  english: "en",
  jpn: "ja",
  japanese: "ja",
  spa: "es",
  spanish: "es",
  fra: "fr",
  fre: "fr",
  french: "fr",
  deu: "de",
  ger: "de",
  german: "de",
  ita: "it",
  italian: "it",
  por: "pt",
  portuguese: "pt",
  kor: "ko",
  korean: "ko",
  zho: "zh",
  chi: "zh",
  chinese: "zh",
}

export function configuredTrackLanguage(
  preference: string,
  systemLanguage = navigator.language,
): string | undefined {
  return (
    normalizeLanguage(preference && preference !== "auto" ? preference : systemLanguage) ||
    undefined
  )
}

export function matchesTrackLanguage(
  preferred: string,
  ...candidates: Array<string | undefined>
): boolean {
  const normalized = normalizeLanguage(preferred)
  return candidates.some((candidate) => {
    if (!candidate) return false
    const candidateLanguage = normalizeLanguage(candidate)
    if (candidateLanguage === normalized) return true
    return candidate
      .toLocaleLowerCase()
      .split(/[^a-z]+/)
      .some((part) => normalizeLanguage(part) === normalized)
  })
}

export function normalizeLanguage(value: string): string {
  const normalized = value.trim().toLocaleLowerCase().replace("_", "-")
  return ISO_639_ALIASES[normalized] ?? normalized.split("-")[0]!
}
