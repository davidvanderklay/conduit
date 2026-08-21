import init, {
  isPlayableStreamUrl as coreIsPlayableStreamUrl,
  selectSavedStream as coreSelectSavedStream,
  selectSingleAutoStream as coreSelectSingleAutoStream,
  streamPlaybackSource,
} from "@conduit/core"
import type { CandidateStream } from "./core-candidate"

// Selection decisions must answer synchronously once the module graph has
// loaded, so the WASM engine initializes at import time. The shared logic
// lives in packages/core (see ADR 0005); the NodeJS build starts eagerly on
// import and exposes no initializer.
if (typeof init === "function") {
  await init()
}

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

function candidateStream(stream: AutoSelectableStream): CandidateStream {
  return {
    url: stream.url,
    infoHash: stream.infoHash,
    fileIdx: stream.fileIdx,
    name: stream.name,
    title: stream.title,
    description: stream.description,
    behaviorHints: stream.behaviorHints,
  }
}

function candidate<T extends AutoSelectableStream>(stream: T) {
  return {
    addonId: stream.addonId ?? "",
    addonName: stream.addonName ?? "",
    stream: candidateStream(stream),
  }
}

export function playbackSourceForStream(stream: AutoSelectableStream): PlaybackSource | undefined {
  if (!stream.addonId) return undefined
  return streamPlaybackSource(stream.addonId, candidateStream(stream)) as PlaybackSource
}

export function selectSavedStream<T extends AutoSelectableStream>(
  streams: T[],
  source: PlaybackSource | undefined,
): T | undefined {
  const index = coreSelectSavedStream(
    streams.map(candidate),
    source ?? null,
  )
  return typeof index === "number" ? streams[index] : undefined
}

export function selectSingleAutoStream<T extends AutoSelectableStream>(
  streams: T[],
  excludedStream?: T,
): T | undefined {
  const index = coreSelectSingleAutoStream(
    streams.map(candidate),
    excludedStream ? candidateStream(excludedStream) : null,
  )
  return typeof index === "number" ? streams[index] : undefined
}

export function isPlayableStreamUrl(value: string | undefined): value is string {
  return typeof value === "string" && coreIsPlayableStreamUrl(value)
}
