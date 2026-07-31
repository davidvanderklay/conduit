export interface AutoSelectableStream {
  key: string
  addonName: string
  url?: string
  name?: string
  title?: string
  description?: string
  behaviorHints?: {
    bingeGroup?: string
    filename?: string
  }
}

export function isPlayableStreamUrl(value: string | undefined): value is string {
  if (!value) return false
  try {
    const protocol = new URL(value).protocol
    return protocol === "http:" || protocol === "https:"
  } catch {
    return false
  }
}

export function selectNextEpisodeStream<T extends AutoSelectableStream>(
  streams: T[],
  current?: AutoSelectableStream,
): T | undefined {
  return streams
    .filter((stream) => isPlayableStreamUrl(stream.url))
    .map((stream) => ({ stream, score: streamMatchScore(stream, current) }))
    .sort((a, b) =>
      (b.score - a.score) ||
      a.stream.addonName.localeCompare(b.stream.addonName) ||
      a.stream.key.localeCompare(b.stream.key))[0]?.stream
}

function streamMatchScore(
  candidate: AutoSelectableStream,
  current?: AutoSelectableStream,
): number {
  if (!current) return 0
  let score = 0
  if (candidate.addonName === current.addonName) score += 1_000
  if (
    candidate.behaviorHints?.bingeGroup &&
    candidate.behaviorHints.bingeGroup === current.behaviorHints?.bingeGroup
  ) score += 400
  const candidateTraits = streamTraits(candidate)
  const currentTraits = streamTraits(current)
  for (const trait of currentTraits) {
    if (candidateTraits.has(trait)) score += 50
  }
  return score
}

function streamTraits(stream: AutoSelectableStream): Set<string> {
  const text = [
    stream.name,
    stream.title,
    stream.description,
    stream.behaviorHints?.filename,
    stream.url,
  ].filter(Boolean).join(" ").toLocaleLowerCase()
  const traits = new Set<string>()
  for (const pattern of [
    /\b(2160p|1080p|720p|480p)\b/g,
    /\b(hevc|h265|x265|h264|x264|av1)\b/g,
    /\b(hdr10|hdr|dolby vision|dv)\b/g,
    /\b(web-dl|webrip|bluray|brrip)\b/g,
  ]) {
    for (const match of text.matchAll(pattern)) traits.add(match[1]!)
  }
  if (/\.m3u8(?:$|[?#])/.test(text)) traits.add("hls")
  return traits
}
