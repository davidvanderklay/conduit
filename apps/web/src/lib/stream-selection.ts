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
