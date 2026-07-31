import type { WatchProgress } from "./api"
import type { CatalogItem, MetaItem, Trailer, TrailerStream, Video } from "./core"

const TEXT_LIMIT = 12_000

function text(value: unknown, limit = TEXT_LIMIT): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined
  const normalized = String(value).replaceAll(String.fromCharCode(0), "").trim().slice(0, limit)
  return normalized || undefined
}

function number(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function stringList(value: unknown): string[] | undefined {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : []
  const normalized = values.flatMap((entry) => {
    const result = text(entry, 180)
    return result ? [result] : []
  })
  return normalized.length ? [...new Set(normalized)].slice(0, 80) : undefined
}

export function safeExternalUrl(value: unknown): string | undefined {
  const candidate = text(value, 4_000)
  if (!candidate) return undefined
  try {
    const url = new URL(candidate)
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined
  } catch {
    return undefined
  }
}

function imageUrl(value: unknown): string | undefined {
  return safeExternalUrl(value)
}

function normalizeVideo(value: unknown, index: number): Video | undefined {
  if (!value || typeof value !== "object") return undefined
  const raw = value as Record<string, unknown>
  const id = text(raw.id, 1_000)
  if (!id) return undefined
  const title = text(raw.title ?? raw.name, 500)
  const overview = text(raw.overview ?? raw.description)
  return {
    id,
    title: title ?? `Episode ${number(raw.episode) ?? index + 1}`,
    season: number(raw.season),
    episode: number(raw.episode),
    released: text(raw.released ?? raw.airDate, 100),
    thumbnail: imageUrl(raw.thumbnail ?? raw.poster),
    overview,
    description: overview,
    runtime: text(raw.runtime, 100),
    available: typeof raw.available === "boolean" ? raw.available : undefined,
  }
}

function normalizeTrailers(value: unknown): Trailer[] | undefined {
  if (!Array.isArray(value)) return undefined
  const trailers = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const raw = entry as Record<string, unknown>
    const source = text(raw.source, 100)
    if (!source) return []
    return [{ source, type: text(raw.type, 100) }]
  })
  return trailers.length ? trailers.slice(0, 20) : undefined
}

function normalizeTrailerStreams(value: unknown): TrailerStream[] | undefined {
  if (!Array.isArray(value)) return undefined
  const trailers = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const raw = entry as Record<string, unknown>
    const youtubeId = text(raw.youtubeId, 100)
    if (!youtubeId || !/^[\w-]{6,}$/.test(youtubeId)) return []
    return [{ youtubeId, title: text(raw.title, 300) }]
  })
  return trailers.length ? trailers.slice(0, 20) : undefined
}

export function normalizeMetaItem(value: unknown, fallback: CatalogItem): MetaItem {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const rawVideos = Array.isArray(raw.videos) ? raw.videos : []
  const videos = rawVideos.flatMap((video, index) => {
    const normalized = normalizeVideo(video, index)
    return normalized ? [normalized] : []
  })
  const releaseInfo = text(raw.releaseInfo ?? raw.year, 100) ?? fallback.releaseInfo
  const contentRating = text(
    raw.contentRating ?? raw.certification ?? raw.ageRating,
    100,
  )

  return {
    id: text(raw.id, 1_000) ?? fallback.id,
    type: text(raw.type, 100) ?? fallback.type,
    name: text(raw.name ?? raw.title, 500) ?? fallback.name,
    poster: imageUrl(raw.poster) ?? imageUrl(fallback.poster),
    background: imageUrl(raw.background) ?? imageUrl(fallback.background),
    logo: imageUrl(raw.logo),
    description: text(raw.description ?? raw.overview) ?? fallback.description,
    releaseInfo,
    runtime: text(raw.runtime, 100) ?? fallback.runtime,
    genres: stringList(raw.genres) ?? fallback.genres,
    imdbRating: text(raw.imdbRating ?? raw.rating, 40),
    contentRating,
    director: stringList(raw.director ?? raw.directors),
    cast: stringList(raw.cast),
    writer: stringList(raw.writer ?? raw.writers),
    country: text(raw.country, 200),
    awards: text(raw.awards, 1_000),
    released: text(raw.released, 100),
    trailers: normalizeTrailers(raw.trailers),
    trailerStreams: normalizeTrailerStreams(raw.trailerStreams),
    videos,
  }
}

export function episodeLabel(video: Video): string {
  if (video.season === 0) {
    return video.episode != null ? `Special ${video.episode}` : "Special"
  }
  if (video.season != null && video.episode != null) {
    return `S${video.season} E${video.episode}`
  }
  if (video.episode != null) return `Episode ${video.episode}`
  return "Episode"
}

export function eligibleSeriesVideos(videos: Video[], now = new Date()): Video[] {
  return videos
    .filter((video) => {
      const release = video.released ? Date.parse(video.released) : Number.NaN
      return video.available !== false &&
        video.season != null &&
        video.season > 0 &&
        video.episode != null &&
        (Number.isNaN(release) || release <= now.getTime())
    })
    .sort((a, b) =>
      (a.season! - b.season!) ||
      (a.episode! - b.episode!) ||
      a.id.localeCompare(b.id))
}

export function selectSeriesVideo(
  videos: Video[],
  progress: WatchProgress[],
  preferredVideoId?: string,
  now = new Date(),
): Video | undefined {
  const eligible = eligibleSeriesVideos(videos, now)
  const eligibleIds = new Set(eligible.map((video) => video.id))
  const byId = new Map(progress.map((entry) => [entry.videoId, entry]))
  if (preferredVideoId && eligibleIds.has(preferredVideoId)) {
    return eligible.find((video) => video.id === preferredVideoId)
  }
  const latest = progress
    .filter((entry) => eligibleIds.has(entry.videoId))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]
  if (latest && !latest.watched && latest.positionMs > 0) {
    return eligible.find((video) => video.id === latest.videoId)
  }
  if (latest?.watched) {
    return nextSeriesVideo(videos, latest.videoId, progress, now)
  }
  return eligible.find((video) => !byId.get(video.id)?.watched)
}

export function nextSeriesVideo(
  videos: Video[],
  currentVideoId: string,
  progress: WatchProgress[],
  now = new Date(),
): Video | undefined {
  const eligible = eligibleSeriesVideos(videos, now)
  const currentIndex = eligible.findIndex((video) => video.id === currentVideoId)
  if (currentIndex < 0) return undefined
  const watched = new Set(
    progress.filter((entry) => entry.watched).map((entry) => entry.videoId),
  )
  return eligible.slice(currentIndex + 1).find((video) => !watched.has(video.id))
}

export function adjacentSeriesVideo(
  videos: Video[],
  currentVideoId: string,
  direction: -1 | 1,
  now = new Date(),
): Video | undefined {
  const eligible = eligibleSeriesVideos(videos, now)
  const currentIndex = eligible.findIndex((video) => video.id === currentVideoId)
  if (currentIndex < 0) return undefined
  return eligible[currentIndex + direction]
}

export function sortSeasons(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => {
    if (a === 0) return 1
    if (b === 0) return -1
    return a - b
  })
}

export function seasonLabel(season: number): string {
  return season === 0 ? "Specials" : `Season ${season}`
}

export function displayDate(value?: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date)
}

export function trailerUrl(meta: MetaItem): string | undefined {
  const id = meta.trailerStreams?.find((trailer) => trailer.youtubeId)?.youtubeId
    ?? meta.trailers?.find((trailer) => trailer.source)?.source
  if (!id) return undefined
  return safeExternalUrl(id) ?? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`
}
