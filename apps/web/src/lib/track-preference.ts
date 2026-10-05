import { trackLanguageCode } from "./languages"

/** Resolves a stored language preference, where "auto" follows the device language. */
export function configuredTrackLanguage(
  preference: string,
  systemLanguage = navigator.language,
): string | undefined {
  return trackLanguageCode(preference && preference !== "auto" ? preference : systemLanguage)
}

export function matchesTrackLanguage(
  preferred: string,
  language?: string,
  label?: string,
): boolean {
  const code = trackLanguageCode(preferred)
  return code !== undefined && trackLanguageCode(language, label) === code
}
