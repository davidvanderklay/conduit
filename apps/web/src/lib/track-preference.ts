import type { InstalledAddon } from "./api"

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
  addons: InstalledAddon[],
): string | undefined {
  if (preference && preference !== "auto") return normalizeLanguage(preference)
  for (const addon of addons) {
    const language = (addon.manifest as unknown as Record<string, unknown>).language
    if (typeof language === "string" && language.trim()) return normalizeLanguage(language)
  }
  return undefined
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
