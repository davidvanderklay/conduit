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

export const AUTO_SELECTION_STARTUP_TIMEOUT_MS = 8_000

export function playbackSourceForStream(stream: AutoSelectableStream): PlaybackSource | undefined {
  if (!stream.addonId) return undefined
  const filename = stream.behaviorHints?.filename
  const kind: PlaybackSourceKind = stream.infoHash ? "torrent" : stream.url ? "url" : "other"
  return {
    addonId: stream.addonId,
    sourceKey: streamSourceKey(stream),
    kind,
    ...(stream.infoHash ? { infoHash: stream.infoHash } : {}),
    ...(stream.fileIdx !== undefined ? { fileIdx: String(stream.fileIdx) } : {}),
    ...(stream.name ? { name: stream.name } : {}),
    ...(stream.title ? { title: stream.title } : {}),
    ...(filename ? { filename } : {}),
    ...(stream.behaviorHints?.bingeGroup ? { bingeGroup: stream.behaviorHints.bingeGroup } : {}),
  }
}

export function selectSavedStream<T extends AutoSelectableStream>(
  streams: T[],
  source: PlaybackSource | undefined,
): T | undefined {
  if (!source) return undefined
  const candidates = streams.filter(isAutoSelectableStream)
  const exactMatches = candidates.filter((stream) => streamSourceKey(stream) === source.sourceKey)
  const sameAddonExactMatches = exactMatches.filter((stream) => stream.addonId === source.addonId)
  if (sameAddonExactMatches.length === 1) return sameAddonExactMatches[0]
  if (sameAddonExactMatches.length > 1) return undefined
  if (exactMatches.length === 1) return exactMatches[0]
  if (!source.bingeGroup) return undefined
  const groupMatches = candidates.filter(
    (stream) => stream.behaviorHints?.bingeGroup === source.bingeGroup,
  )
  const sameAddonGroupMatches = groupMatches.filter((stream) => stream.addonId === source.addonId)
  if (sameAddonGroupMatches.length === 1) return sameAddonGroupMatches[0]
  if (sameAddonGroupMatches.length > 1) return undefined
  return groupMatches.length === 1 ? groupMatches[0] : undefined
}

export function selectSingleAutoStream<T extends AutoSelectableStream>(
  streams: T[],
  excludedStream?: T,
): T | undefined {
  const excludedSourceKey = excludedStream && streamSourceKey(excludedStream)
  const candidates = streams.filter(
    (stream) =>
      isAutoSelectableStream(stream) &&
      (!excludedSourceKey || streamSourceKey(stream) !== excludedSourceKey),
  )
  return candidates.length === 1 ? candidates[0] : undefined
}

export function isAutoSelectableStream(stream: AutoSelectableStream): stream is AutoSelectableStream & {
  url: string
} {
  return isPlayableStreamUrl(stream.url)
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
