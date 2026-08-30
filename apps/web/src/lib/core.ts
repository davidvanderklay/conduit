import init, {
  evaluateCore,
  fetchManifest,
  fetchResource,
  type InitInput,
} from "../../../../packages/core/pkg/conduit_core.js"
import type { AddonManifest } from "./api"

let initialization: Promise<unknown> | undefined
let initialized = false

export function initializeCore(input?: InitInput) {
  initialization ??= init(input).then((value) => {
    initialized = true
    return value
  })
  return initialization
}

function ready() {
  return initializeCore()
}

export function coreValue<T>(action: object): T {
  if (!initialized) throw new Error("conduit-core must be initialized before use")
  const response = JSON.parse(evaluateCore(JSON.stringify(action))) as {
    ok: boolean
    value?: T
    error?: { code: string; message: string }
  }
  if (!response.ok) {
    throw new Error(`${response.error?.code ?? "core_error"}: ${response.error?.message ?? "Rust core operation failed"}`)
  }
  return response.value as T
}

export async function loadManifest(url: string): Promise<AddonManifest> {
  await ready()
  return (await fetchManifest(url)) as AddonManifest
}

export interface CatalogItem {
  id: string
  type: string
  name: string
  poster?: string
  background?: string
  description?: string
  releaseInfo?: string
  runtime?: string
  genres?: string[]
}

export interface Video {
  id: string
  title?: string
  season?: number
  episode?: number
  released?: string
  thumbnail?: string
  overview?: string
  description?: string
  runtime?: string
  available?: boolean
}

export interface MetaItem extends CatalogItem {
  logo?: string
  defaultVideoId?: string
  releaseInfo?: string
  runtime?: string
  genres?: string[]
  imdbRating?: string
  contentRating?: string
  director?: string[]
  cast?: string[]
  writer?: string[]
  country?: string
  awards?: string
  released?: string
  trailers?: Trailer[]
  trailerStreams?: TrailerStream[]
  videos?: Video[]
}

export interface Trailer {
  source?: string
  type?: string
}

export interface TrailerStream {
  title?: string
  youtubeId?: string
}

export interface Stream {
  url?: string
  externalUrl?: string
  infoHash?: string
  fileIdx?: number
  name?: string
  title?: string
  description?: string
  behaviorHints?: {
    bingeGroup?: string
    notWebReady?: boolean
    filename?: string
    videoSize?: number
  }
}

export interface Subtitle {
  id: string
  url: string
  lang?: string
  language?: string
  languageCode?: string
  locale?: string
  label?: string
}

export async function loadCatalog(
  manifestUrl: string,
  type: string,
  id: string,
  extras: Array<{ name: string; value: string }> = [],
): Promise<CatalogItem[]> {
  await ready()
  const response = (await fetchResource(manifestUrl, "catalog", type, id, extras)) as {
    metas?: CatalogItem[]
  }
  return response.metas ?? []
}

export async function loadMeta(manifestUrl: string, type: string, id: string): Promise<MetaItem> {
  await ready()
  const response = (await fetchResource(manifestUrl, "meta", type, id, [])) as { meta?: MetaItem }
  if (!response.meta) {
    throw new Error("add-on returned no metadata")
  }
  return response.meta
}

export async function loadStreams(
  manifestUrl: string,
  type: string,
  videoId: string,
): Promise<Stream[]> {
  await ready()
  const response = (await fetchResource(manifestUrl, "stream", type, videoId, [])) as {
    streams?: Stream[]
  }
  return response.streams ?? []
}

export async function loadSubtitles(
  manifestUrl: string,
  type: string,
  videoId: string,
): Promise<Subtitle[]> {
  await ready()
  const response = (await fetchResource(
    manifestUrl,
    "subtitles",
    type === "tv" ? "series" : type,
    videoId,
    [],
  )) as { subtitles?: Subtitle[] }
  return response.subtitles ?? []
}
