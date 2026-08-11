export type PlaybackSourceKind = "url" | "torrent" | "other"

export interface PlaybackSource {
  addonId: string
  sourceKey: string
  kind: PlaybackSourceKind
  infoHash?: string
  fileIdx?: string
  name?: string
  title?: string
  filename?: string
  bingeGroup?: string
}

export interface AutoSelectableStream {
  key: string
  addonId?: string
  addonName: string
  url?: string
  infoHash?: string
  fileIdx?: number
  name?: string
  title?: string
  description?: string
  behaviorHints?: {
    bingeGroup?: string
    filename?: string
  }
}

export function playbackSourceForStream(
  stream: AutoSelectableStream,
): PlaybackSource | undefined {
  if (!stream.addonId) return undefined
  const filename = stream.behaviorHints?.filename
  const kind: PlaybackSourceKind = stream.infoHash
    ? "torrent"
    : stream.url
      ? "url"
      : "other"
  return {
    addonId: stream.addonId,
    sourceKey: streamSourceKey(stream),
    kind,
    ...(stream.infoHash ? { infoHash: stream.infoHash } : {}),
    ...(stream.fileIdx !== undefined ? { fileIdx: String(stream.fileIdx) } : {}),
    ...(stream.name ? { name: stream.name } : {}),
    ...(stream.title ? { title: stream.title } : {}),
    ...(filename ? { filename } : {}),
    ...(stream.behaviorHints?.bingeGroup
      ? { bingeGroup: stream.behaviorHints.bingeGroup }
      : {}),
  }
}

export function selectSavedStream<T extends AutoSelectableStream>(
  streams: T[],
  source: PlaybackSource | undefined,
): T | undefined {
  if (!source) return undefined
  return streams
    .filter((stream) => stream.addonId === source.addonId && isPlayableStreamUrl(stream.url))
    .find((stream) => streamSourceKey(stream) === source.sourceKey)
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

function streamSourceKey(stream: AutoSelectableStream): string {
  if (stream.infoHash) {
    return `torrent:${stream.infoHash.toLowerCase()}:${stream.fileIdx ?? ""}`
  }
  if (stream.url) return `url:${normalizedStreamUrl(stream.url)}`
  return `other:${normalizeSourceText([stream.name, stream.title, stream.behaviorHints?.filename])}`
}

function normalizedStreamUrl(value: string): string {
  try {
    const url = new URL(value)
    const stableQuery = [...url.searchParams.entries()]
      .filter(([key]) => !/(token|sig|signature|expires|expiry|auth|key)/i.test(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${key}=${item}`)
      .join("&")
    const path = url.pathname.replace(/\/+$/, "") || "/"
    return `${url.protocol}//${url.host}${path}${stableQuery ? `?${stableQuery}` : ""}`
  } catch {
    return value.split(/[?#]/, 1)[0]!.replace(/\/+$/, "")
  }
}

function normalizeSourceText(values: Array<string | undefined>): string {
  return values.filter(Boolean).join("|").trim().toLocaleLowerCase().replace(/\s+/g, " ")
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
