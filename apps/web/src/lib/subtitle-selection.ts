import { configuredTrackLanguage, matchesTrackLanguage } from "./track-preference"

export interface SubtitleCandidate<T> {
  track: T
  language?: string
  title?: string
  embedded: boolean
  /** The container's forced flag, when the player exposes it. */
  forced?: boolean
}

/** Forced tracks carry the container flag or say so in their title, as signs-and-songs tracks do. */
export function isForcedSubtitle(forced: boolean | undefined, title?: string): boolean {
  return Boolean(forced) || /\bforced\b|\bsigns\s*(?:&|and)\s*songs\b/i.test(title ?? "")
}

/**
 * Undefined waits for discovery; null means no configured language is available.
 * With `forcedOnly`, only forced tracks are eligible.
 */
export function preferredSubtitle<T>({
  candidates: allCandidates,
  primary,
  secondary,
  embeddedReady,
  addonsReady,
  forcedOnly = false,
}: {
  candidates: SubtitleCandidate<T>[]
  primary: string
  secondary: string | null
  embeddedReady: boolean
  addonsReady: boolean
  forcedOnly?: boolean
}): T | null | undefined {
  if (!embeddedReady) return undefined
  const candidates = forcedOnly
    ? allCandidates.filter((candidate) => isForcedSubtitle(candidate.forced, candidate.title))
    : allCandidates
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
