import { configuredTrackLanguage, matchesTrackLanguage } from "./track-preference"

export interface SubtitleCandidate<T> {
  track: T
  language?: string
  title?: string
  embedded: boolean
}

/** Undefined waits for discovery; null means no configured language is available. */
export function preferredSubtitle<T>({
  candidates,
  primary,
  secondary,
  embeddedReady,
  addonsReady,
}: {
  candidates: SubtitleCandidate<T>[]
  primary: string
  secondary: string | null
  embeddedReady: boolean
  addonsReady: boolean
}): T | null | undefined {
  if (!embeddedReady) return undefined
  const languages = [
    ...new Set(
      [
        configuredTrackLanguage(primary),
        secondary ? configuredTrackLanguage(secondary) : undefined,
      ].filter((language): language is string => Boolean(language)),
    ),
  ]
  const matching = (language: string) =>
    candidates.filter((candidate) =>
      matchesTrackLanguage(language, candidate.language, candidate.title),
    )
  const primaryEmbedded =
    languages[0] && matching(languages[0]).find((candidate) => candidate.embedded)
  if (primaryEmbedded) return primaryEmbedded.track
  if (!addonsReady) return undefined
  for (const language of languages) {
    const tracks = matching(language)
    const best = tracks.find((candidate) => candidate.embedded) ?? tracks[0]
    if (best) return best.track
  }
  return null
}

/** A stalled provider must not prevent fallback forever. Keep completed provider results. */
export function subtitleLookupResults<T>(requests: Promise<T>[], timeoutMs = 10_000) {
  return Promise.allSettled(
    requests.map(
      (request) =>
        new Promise<T>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Subtitle lookup timed out")), timeoutMs)
          request.then(resolve, reject).finally(() => clearTimeout(timer))
        }),
    ),
  )
}
