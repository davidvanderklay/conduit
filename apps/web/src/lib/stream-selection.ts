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
  const candidates = streams.filter(
    (stream) => stream.addonId === source.addonId && isPlayableStreamUrl(stream.url),
  )
  const exactMatch = candidates.find((stream) => streamSourceKey(stream) === source.sourceKey)
  if (exactMatch) return exactMatch
  if (!source.bingeGroup) return undefined
  return candidates.find((stream) => stream.behaviorHints?.bingeGroup === source.bingeGroup)
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
