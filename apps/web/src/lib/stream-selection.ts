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
  sources?: string[]
  name?: string
  title?: string
  description?: string
  behaviorHints?: {
    bingeGroup?: string
    filename?: string
  }
}

export const AUTO_SELECTION_STARTUP_TIMEOUT_MS = 8_000
/** Torrents need peers and metadata first; the desktop shell gives up after 95s. */
export const TORRENT_STARTUP_TIMEOUT_MS = 120_000

export function playbackSourceForStream(stream: AutoSelectableStream): PlaybackSource | undefined {
  if (!stream.addonId) return undefined
  return coreValue<PlaybackSource>({
    type: "playbackSource",
    addonId: stream.addonId,
    stream: coreStream(stream),
  })
}

export function selectSavedStream<T extends AutoSelectableStream>(
  streams: T[],
  source: PlaybackSource | undefined,
): T | undefined {
  const index = coreValue<number | null>({
    type: "selectSavedStream",
    p2pAvailable: p2pAvailable(),
    streams: streams.map(coreCandidate),
    source: source ?? null,
  })
  return index == null ? undefined : streams[index]
}

export function selectSingleAutoStream<T extends AutoSelectableStream>(
  streams: T[],
  excludedStream?: T,
): T | undefined {
  const index = coreValue<number | null>({
    type: "selectSingleStream",
    p2pAvailable: p2pAvailable(),
    streams: streams.map(coreCandidate),
    excluded: excludedStream ? coreStream(excludedStream) : null,
  })
  return index == null ? undefined : streams[index]
}

export function rankAutomaticStreams<T extends AutoSelectableStream>(
  streams: T[],
  previousSource?: PlaybackSource,
  savedSource?: PlaybackSource,
): T[] {
  const indexes = coreValue<number[]>({
    type: "rankStreams",
    p2pAvailable: p2pAvailable(),
    streams: streams.map(coreCandidate),
    previous: previousSource ?? null,
    saved: savedSource ?? null,
  })
  return indexes.flatMap((index) => (streams[index] ? [streams[index]] : []))
}

export function isAutoSelectableStream(
  stream: AutoSelectableStream,
): stream is AutoSelectableStream & {
  url: string
} {
  return isPlayableStreamUrl(stream.url)
}

export function isPlayableStreamUrl(value: string | undefined): value is string {
  return coreValue<boolean>({ type: "isPlayableStreamUrl", value: value ?? null })
}

/**
 * The URL the player opens for a stream, or undefined when this host cannot
 * play it. Torrents become magnets on P2P hosts, with the file index as BEP 53
 * `so` and tracker hints as `tr`.
 */
export function streamPlaybackUrl(stream: AutoSelectableStream): string | undefined {
  const { url } = stream
  if (isPlayableStreamUrl(url)) return url
  const torrent = coreValue<boolean>({
    type: "isPlayableStream",
    stream: coreStream(stream),
    p2pAvailable: p2pAvailable(),
  })
  if (!torrent) return undefined
  const magnet = new URL(
    stream.url?.startsWith("magnet:") ? stream.url : `magnet:?xt=urn:btih:${stream.infoHash}`,
  )
  if (stream.fileIdx != null) magnet.searchParams.set("so", String(stream.fileIdx))
  for (const source of stream.sources ?? []) {
    if (source.startsWith("tracker:")) magnet.searchParams.append("tr", source.slice(8))
  }
  return magnet.href
}

function coreCandidate(stream: AutoSelectableStream) {
  return {
    addonId: stream.addonId ?? "",
    addonName: stream.addonName,
    stream: coreStream(stream),
  }
}

function coreStream(stream: AutoSelectableStream) {
  return {
    url: stream.url,
    infoHash: stream.infoHash,
    fileIdx: stream.fileIdx,
    sources: stream.sources,
    name: stream.name,
    title: stream.title,
    description: stream.description,
    behaviorHints: stream.behaviorHints
      ? {
          filename: stream.behaviorHints.filename,
          bingeGroup: stream.behaviorHints.bingeGroup,
        }
      : undefined,
  }
}
import { coreValue } from "./core"
import { p2pAvailable } from "./desktop"
